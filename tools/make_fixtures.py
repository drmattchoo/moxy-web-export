"""Generate the raw `gd` dumps in tests/fixtures/ (deterministic).

Run from the repository root:  python3 tools/make_fixtures.py

The fixtures are committed; regenerate only when you change this script.
Expected outputs are made separately by tests/parity.py from moxy_dump.py.
"""
import math
import pathlib
from datetime import datetime, timedelta

OUT = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures"


def row(t, i, style="plain"):
    """One log line in the device's own format (no zero padding)."""
    live = 55 + int(12 * math.sin(i / 9.0))
    avg = 55 + int(10 * math.sin((i - 3) / 9.0))
    thb = f"{12.0 + 0.4 * math.cos(i / 7.0):.2f}"
    lap = str(i // 40)
    stamp = f"{t.month}-{t.day},{t.hour}:{t.minute}:{t.second}"
    if style == "extra":          # 7 fields: extra column present
        return f"{stamp},{live},{avg},{thb},{lap},{i % 3}"
    if style == "short":          # 5 fields: no extra column -> padded
        return f"{stamp},{live},{avg},{thb}"
    if style == "long":           # 8 fields -> truncated to 5 after time
        return f"{stamp},{live},{avg},{thb},{lap},7,99"
    if style == "quoted":         # quotes and stray spaces are trimmed
        return f' {stamp}, "{live}" ,{avg} , "{thb}",{lap}'
    return f"{stamp},{live},{avg},{thb},{lap}"


def session(start, n, step=2, styles=None, gaps=None):
    """n rows from start every `step` s; gaps maps row index -> extra seconds."""
    lines, t = [], start
    for i in range(n):
        if gaps and i in gaps:
            t += timedelta(seconds=gaps[i])
        style = (styles or {}).get(i % 10, "plain")
        lines.append(row(t, i, style))
        t += timedelta(seconds=step)
    return lines


def dump(lines):
    body = "gd\r\n" + "".join(l + "\r\n" for l in lines) + "\r\n>"
    return body.encode("utf-8")


def write(name, lines):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_bytes(dump(lines))
    print(f"wrote {OUT / name}")


def ringbuffer():
    """Demo fixture: out-of-order ring buffer with every awkward case."""
    old = session(datetime(2026, 12, 20, 18, 0, 0), 40)          # 12-20 -> 2025
    a = session(datetime(2026, 10, 27, 9, 5, 1), 90,
                styles={3: "extra", 7: "short"})
    b = session(datetime(2026, 10, 27, 14, 20, 0), 60,
                styles={1: "extra", 4: "quoted", 6: "long", 9: "short"})
    short = session(datetime(2026, 10, 28, 8, 0, 0), 12)          # < min rows
    # Gaps of exactly 30:00 and 29:59 stay inside one session.
    c = session(datetime(2026, 10, 28, 16, 0, 0), 60,
                gaps={20: 30 * 60 - 2, 40: 30 * 60 - 3})
    garbage = [
        "Moxy log v2", "ERR", "", "1-1", "10-27,9:5", "99-99,1:1:1,1,1,1,1",
        "\x00\x01junk", "10/27/2026,09:05:01,1,2,3,4", "--", "a-b,c:d:e,1",
    ]
    # Wrapped buffer: newest data first, oldest last, delimiters between.
    lines = (b[25:] + [",,,,,"] + short + [" ,,,,,"] + garbage[:5] + c
             + [",,,,,"] + old + [" ,,,,,"] + garbage[5:] + a + [",,,,,"] + b[:25])
    write("ringbuffer.txt", lines)


def rollover():
    """New Year inside one session, future mm-dd, and invalid dates."""
    ny = session(datetime(2026, 12, 31, 23, 58, 0), 120)
    future = session(datetime(2026, 10, 30, 7, 0, 0), 35)        # -> 2025-10-30
    today = session(datetime(2026, 10, 29, 7, 0, 0), 35)         # stays 2026
    invalid = [
        "2-29,10:0:0,50,50,12.00,0",     # 2026 is not a leap year
        "2-30,10:0:0,50,50,12.00,0",
        "13-1,10:0:0,50,50,12.00,0",
        "0-5,10:0:0,50,50,12.00,0",
        "10-27,25:0:0,50,50,12.00,0",
        "10-27,10:61:0,50,50,12.00,0",
    ]
    lines = future + invalid + ny[60:] + [" ,,,,,"] + today + ny[:60]
    write("rollover.txt", lines)


def nosessions():
    """Only a short session and junk: zero complete recordings."""
    lines = ["Moxy"] + session(datetime(2026, 10, 28, 8, 0, 0), 10) + [",,,,,"]
    write("nosessions.txt", lines)


if __name__ == "__main__":
    ringbuffer()
    rollover()
    nosessions()
