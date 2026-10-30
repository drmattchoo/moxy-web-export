#!/usr/bin/env python3
"""
moxy_dump.py - download the on-board log from an older (USB-serial) Moxy
muscle-oxygen sensor and write one CSV per recording session.

Runs natively on macOS (Apple Silicon or Intel), Linux and Windows.
Needs only pyserial:   pip install pyserial

Protocol: the sensor exposes a plain-text "engineering" console over a USB
virtual COM port at 115200 baud. Sending CR gives a ">" prompt; "gd" streams
the stored log as CSV lines; "exit" leaves the console. This is the same
sequence the open-source GoldenCheetah MoxyDevice driver (GPL, Mark Liversedge
2014) uses, re-implemented here in Python.

Usage
  python3 moxy_dump.py                      # auto-detect port, write ./moxy_export/
  python3 moxy_dump.py --port /dev/tty.usbmodem14101 --out ~/moxy_export
  python3 moxy_dump.py --list               # list serial ports and exit
  python3 moxy_dump.py --year 2025          # force the calendar year (log has no year)
  python3 moxy_dump.py --clear              # erase device memory AFTER a successful dump

Output (in --out directory)
  raw_gd_<timestamp>.txt      exact bytes received from the device (keep for provenance)
  device_info_<timestamp>.txt firmware / clock / battery / update-mode strings
  session_<YYYY-MM-DD>_<HHMMSS>.csv   one file per session (gap > --gap minutes)
"""

import argparse
import datetime as dt
import re
import sys
import time
from pathlib import Path

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("pyserial is missing:  pip install pyserial")

__version__ = "1.0"
BAUD = 115200
PROMPT = b">"
CSV_HEADER = ["date", "time", "smo2_live", "smo2_avg", "thb", "lap", "extra"]


# ----------------------------------------------------------------------------
# serial helpers
# ----------------------------------------------------------------------------
def find_port() -> str:
    ports = list(list_ports.comports())
    cands = [p for p in ports if re.search(r"usbmodem|usbserial|ttyACM|ttyUSB|COM\d", p.device, re.I)]
    if not cands:
        sys.exit("No USB serial port found. Plug in the Moxy, wait 5 s, then run --list.")
    if len(cands) > 1:
        print("Several USB serial ports found - pick one with --port:")
        for p in cands:
            print(f"  {p.device}   {p.description}   {p.hwid}")
        sys.exit(1)
    return cands[0].device


def read_until_prompt(ser: serial.Serial, timeout: float = 3.0) -> bytes:
    """Read until a '>' prompt or until `timeout` seconds of silence."""
    buf = bytearray()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        chunk = ser.read(256)
        if chunk:
            buf += chunk
            deadline = time.monotonic() + timeout
            if buf.rstrip().endswith(PROMPT):
                break
    return bytes(buf)


def command(ser: serial.Serial, cmd: str, timeout: float = 3.0) -> str:
    time.sleep(0.1)
    ser.write(cmd.encode("ascii") + b"\r")
    ser.flush()
    raw = read_until_prompt(ser, timeout)
    txt = raw.decode("ascii", errors="replace")
    # strip echoed command and trailing prompt
    txt = txt.replace(cmd, "", 1).rstrip(">").strip()
    return txt


def wake(ser: serial.Serial) -> bool:
    """Send CR until the device answers with a prompt (GoldenCheetah sends three)."""
    for _ in range(5):
        ser.write(b"\r")
        ser.flush()
        if read_until_prompt(ser, 2.0).rstrip().endswith(PROMPT):
            return True
    return False


# ----------------------------------------------------------------------------
# parsing
# ----------------------------------------------------------------------------
LINE_RE = re.compile(r"^\s*(\d{1,2})-(\d{1,2}),(\d{1,2}):(\d{1,2}):(\d{1,2}),(.*)$")


def parse_line(line: str, assumed_year: int, today: dt.date):
    """Return (timestamp, [fields]) or None for delimiter / malformed lines."""
    s = line.strip()
    if not s or set(s) <= {",", " "}:
        return None
    m = LINE_RE.match(s)
    if not m:
        return None
    mo, d, hh, mm, ss = (int(x) for x in m.groups()[:5])
    rest = [f.strip().strip('"') for f in m.group(6).split(",")]
    year = assumed_year
    try:
        date = dt.date(year, mo, d)
    except ValueError:
        return None
    # the on-board log stores mm-dd only; if that date lies in the future,
    # the sample was recorded last year.
    if date > today:
        year -= 1
        date = dt.date(year, mo, d)
    try:
        ts = dt.datetime(year, mo, d, hh, mm, ss)
    except ValueError:
        return None
    # expected: smo2_live, smo2_avg, thb, lap [, extra]
    rest = (rest + [""] * 5)[:5]
    return ts, rest


def split_sessions(rows, gap_min: float):
    rows.sort(key=lambda r: r[0])
    sessions, cur, last = [], [], None
    for ts, fields in rows:
        if last is not None and (ts - last).total_seconds() > gap_min * 60:
            sessions.append(cur)
            cur = []
        cur.append((ts, fields))
        last = ts
    if cur:
        sessions.append(cur)
    return sessions


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial port (default: auto-detect)")
    ap.add_argument("--out", default="moxy_export", help="output directory")
    ap.add_argument("--year", type=int, default=dt.date.today().year,
                    help="calendar year to assume for the log (device stores mm-dd only)")
    ap.add_argument("--gap", type=float, default=30.0, help="minutes of silence that start a new session")
    ap.add_argument("--min-rows", type=int, default=30, help="discard sessions shorter than this")
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    ap.add_argument("--version", action="version", version=f"moxy_dump.py v{__version__}")
    ap.add_argument("--clear", action="store_true", help="erase device memory after a successful dump")
    args = ap.parse_args()

    if args.list:
        for p in list_ports.comports():
            print(f"{p.device:28s} {p.description}   {p.hwid}")
        return

    port = args.port or find_port()
    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")

    print(f"moxy_dump.py v{__version__}  -  opening {port} @ {BAUD} ...")
    with serial.Serial(port, BAUD, timeout=0.5) as ser:
        ser.reset_input_buffer()
        if not wake(ser):
            sys.exit("No '>' prompt from the device. Check the cable (must be a data cable), "
                     "try pressing the Moxy button once, and confirm the port with --list.")

        info = {}
        for name, cmd in [("firmware", "ver"), ("device_clock", "time"),
                          ("battery", "batt"), ("update_mode", "um")]:
            info[name] = command(ser, cmd)
            print(f"  {name:13s}: {info[name].replace(chr(10), ' | ')}")
        (out / f"device_info_{stamp}.txt").write_text(
            "\n".join(f"{k}: {v}" for k, v in info.items())
            + f"\nport: {port}\nscript: moxy_dump.py v{__version__}"
            + f"\ndownloaded_at: {dt.datetime.now().isoformat()}\n")

        print("Downloading log (gd) ...")
        time.sleep(0.1)
        ser.write(b"gd\r")
        ser.flush()
        raw = bytearray()
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            chunk = ser.read(4096)
            if chunk:
                raw += chunk
                deadline = time.monotonic() + 5.0   # keep going while data flows
                sys.stdout.write(f"\r  {len(raw):,} bytes")
                sys.stdout.flush()
                tail = raw[-64:]
                if tail.rstrip().endswith(PROMPT) and b"\r\n" in tail:
                    break
        print()
        (out / f"raw_gd_{stamp}.txt").write_bytes(bytes(raw))

        command(ser, "exit", 1.0)

        text = raw.decode("ascii", errors="replace")
        today = dt.date.today()
        rows = [r for r in (parse_line(l, args.year, today) for l in text.splitlines()) if r]
        print(f"  {len(rows)} data rows parsed")

        sessions = [s for s in split_sessions(rows, args.gap) if len(s) >= args.min_rows]
        for s in sessions:
            start = s[0][0]
            fn = out / f"session_{start:%Y-%m-%d_%H%M%S}.csv"
            with fn.open("w", newline="") as f:
                f.write("# " + info["firmware"].replace("\n", " | ") + f" | moxy_dump.py v{__version__}\n")
                f.write("# year assumed from --year / today's date; device log stores mm-dd only\n")
                f.write(",".join(CSV_HEADER) + "\n")
                for ts, fields in s:
                    f.write(f"{ts:%Y-%m-%d},{ts:%H:%M:%S}," + ",".join(fields) + "\n")
            print(f"  wrote {fn.name}  ({len(s)} rows, {s[0][0]:%H:%M:%S}-{s[-1][0]:%H:%M:%S})")
        if not sessions:
            print("  no session with >= --min-rows rows; inspect the raw_gd file.")

        if args.clear and sessions:
            ans = input("Erase ALL data on the sensor now? type 'erase' to confirm: ")
            if ans.strip() == "erase":
                wake(ser)
                print("  " + command(ser, "cd", 5.0))
                time.sleep(3)
                command(ser, "exit", 1.0)
                print("  device memory cleared")
            else:
                print("  not cleared")


if __name__ == "__main__":
    main()
