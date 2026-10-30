"""Write the expected session CSVs for each fixture using moxy_dump.py.

Run from the repository root:  python3 tests/parity.py

This imports parse_line and split_sessions from the reference script
(moxy_dump.py, in the repository root) and follows its main() exactly:
ASCII decode with replacement, splitlines, parse, split, keep sessions with
at least --min-rows rows, and write each CSV with the same f-strings. Output
goes to tests/expected/<case>/session_<YYYY-MM-DD>_<HHMMSS>.csv. The JS core
must reproduce these files byte for byte (tests/parity.test.mjs).

The first comment line names the tool that wrote the file. moxy_dump.py
writes "moxy_dump.py v1.0"; here it is "moxy-web v1.0" so the comparison
checks everything else exactly.
"""
import pathlib
import shutil
import sys
import types
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Parsing needs no serial port: stand in for pyserial if it is not installed.
try:
    import serial  # noqa: F401
except ImportError:
    serial = types.ModuleType("serial")
    serial.Serial = object
    serial.tools = types.ModuleType("serial.tools")
    serial.tools.list_ports = types.ModuleType("serial.tools.list_ports")
    sys.modules.update({"serial": serial, "serial.tools": serial.tools,
                        "serial.tools.list_ports": serial.tools.list_ports})

try:
    from moxy_dump import parse_line, split_sessions  # noqa: E402
except ImportError as exc:
    sys.exit(f"parity.py: cannot import moxy_dump.py from {ROOT}: {exc}\n"
             "Copy the reference script moxy_dump.py into the repository root.")

FIXTURES = ROOT / "tests" / "fixtures"
EXPECTED = ROOT / "tests" / "expected"

# Fixed inputs shared with tests/parity.test.mjs and the demo sensor.
TODAY = date(2026, 10, 29)
YEAR = 2026
FIRMWARE = (FIXTURES / "firmware.txt").read_text().strip()
TOOL = "moxy-web v1.0"
CSV_HEADER = ["date", "time", "smo2_live", "smo2_avg", "thb", "lap", "extra"]

CASES = [
    # (case name, fixture, gap minutes, minimum rows)
    ("ringbuffer", "ringbuffer.txt", 30, 30),
    ("ringbuffer_gap10_min5", "ringbuffer.txt", 10, 5),
    ("rollover", "rollover.txt", 30, 30),
    ("edgecases", "edgecases.txt", 30, 30),
    ("nosessions", "nosessions.txt", 30, 30),
]


def main():
    if EXPECTED.exists():
        shutil.rmtree(EXPECTED)
    for name, fixture, gap, min_rows in CASES:
        # --- as moxy_dump.main() ---
        text = (FIXTURES / fixture).read_bytes().decode("ascii", errors="replace")
        rows = [r for r in (parse_line(l, YEAR, TODAY) for l in text.splitlines()) if r]
        sessions = [s for s in split_sessions(rows, gap) if len(s) >= min_rows]
        out = EXPECTED / name
        out.mkdir(parents=True)
        for s in sessions:
            start = s[0][0]
            fn = out / f"session_{start:%Y-%m-%d_%H%M%S}.csv"
            with fn.open("w", newline="", encoding="utf-8") as f:
                f.write("# " + FIRMWARE.replace("\n", " | ") + f" | {TOOL}\n")
                f.write("# year assumed from --year / today's date; device log stores mm-dd only\n")
                f.write(",".join(CSV_HEADER) + "\n")
                for ts, fields in s:
                    f.write(f"{ts:%Y-%m-%d},{ts:%H:%M:%S}," + ",".join(fields) + "\n")
        # ---
        print(f"{name}: {len(rows)} rows, {len(sessions)} sessions")


if __name__ == "__main__":
    main()
