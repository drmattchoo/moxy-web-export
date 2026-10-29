"""Write the expected session CSVs for each fixture using moxy_dump.py.

Run from the repository root:  python3 tests/parity.py

This imports parse_line and split_sessions from the reference script
(moxy_dump.py, in the repository root) and writes, for every case below,
tests/expected/<case>/session_<YYYY-MM-DD>_<HHMMSS>.csv. The JS core must
reproduce these files byte for byte (tests/parity.test.mjs).

The first comment line names the tool that wrote the file. The Python
script would write "moxy_dump.py v1.0"; here it writes "moxy-web v1.0" so
the comparison checks everything else exactly.
"""
import csv
import io
import pathlib
import shutil
import sys
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

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
VERSION = "moxy-web v1.0"
YEAR_COMMENT = "# year assumed from --year / today's date; device log stores mm-dd only"

CASES = [
    # (case name, fixture, gap minutes, minimum rows)
    ("ringbuffer", "ringbuffer.txt", 30, 30),
    ("ringbuffer_gap10_min5", "ringbuffer.txt", 10, 5),
    ("rollover", "rollover.txt", 30, 30),
    ("nosessions", "nosessions.txt", 30, 30),
]


def rows_from_dump(raw):
    text = raw.decode("utf-8", errors="replace")
    rows = [r for r in (parse_line(l, YEAR, TODAY) for l in text.splitlines()) if r]
    rows.sort(key=lambda r: r[0])
    return rows


def session_csv(rows):
    buf = io.StringIO()
    buf.write(f"# {FIRMWARE.replace(chr(10), ' | ')} | {VERSION}\n")
    buf.write(YEAR_COMMENT + "\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["date", "time", "smo2_live", "smo2_avg", "thb", "lap", "extra"])
    for ts, fields in rows:
        w.writerow([ts.strftime("%Y-%m-%d"), ts.strftime("%H:%M:%S"), *fields])
    return buf.getvalue()


def main():
    if EXPECTED.exists():
        shutil.rmtree(EXPECTED)
    for name, fixture, gap, min_rows in CASES:
        rows = rows_from_dump((FIXTURES / fixture).read_bytes())
        sessions = split_sessions(rows, gap, min_rows)
        out = EXPECTED / name
        out.mkdir(parents=True)
        for s in sessions:
            fn = f"session_{s[0][0].strftime('%Y-%m-%d_%H%M%S')}.csv"
            (out / fn).write_bytes(session_csv(s).encode("utf-8"))
        print(f"{name}: {len(rows)} rows, {len(sessions)} sessions")


if __name__ == "__main__":
    main()
