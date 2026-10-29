# Moxy Data Export (web)

A single web page that downloads the stored log from an older **USB Moxy muscle-oxygen (NIRS) sensor** and saves it as CSV files. It replaces the Terminal workflow of `moxy_dump.py` v1.0: it speaks the same protocol and writes the same files.

Nothing to install. Open the page, fill in the session details, choose a save folder, connect the sensor, download.

## Supported browsers

**Google Chrome or Microsoft Edge on a desktop computer** (Mac with Apple Silicon or Intel, or Windows). The page uses the Web Serial API and the File System Access API, which only these browsers provide, and only over HTTPS or `localhost`. In any other browser the page shows: "Open this page in Google Chrome or Microsoft Edge on a computer."

After the first load the page works offline: fonts and code are all inside `index.html`.

## Using it

1. **Session details.** Date, study code, participant code and the year of recording. Codes may contain letters, numbers and hyphens only. Use codes only: no names or hospital numbers. The folder name (`YYYY-MM-DD_STUDY_PARTICIPANT`) is shown as you type.
2. **Save folder.** Choose a parent folder once. The page remembers it and asks for access again on later visits ("Allow access").
3. **Connect sensor.** Choose the Moxy in the browser's port list. The page shows firmware, battery, update mode, and the sensor clock beside the computer clock. A difference of more than 2 minutes is highlighted: session times come from the sensor clock.
4. **Download.** Shows a live byte count, then a table of sessions, then saves the files.
5. **Result.** "Saved N sessions to …". Compare each start time and duration with the paper session log, then copy the folder to study storage.
6. **Erase sensor** (collapsed). Only available after this page has saved a complete download with at least one session. Type `erase` to enable the button.
7. **Advanced** (collapsed). Session gap and minimum rows, and the console log of every command and reply, which you can save for support.

### Files written

Into a new subfolder `YYYY-MM-DD_STUDY_PARTICIPANT` of the save folder (`<stamp>` is the local download time, `YYYYMMDD_HHMMSS`):

| File | Contents |
|---|---|
| `raw_gd_<stamp>.txt` | The exact bytes received after `gd`, unmodified |
| `device_info_<stamp>.txt` | `firmware`, `device_clock`, `battery`, `update_mode`, `port` (USB vendor/product id), `script: moxy-web v1.0`, `downloaded_at` |
| `session_<YYYY-MM-DD>_<HHMMSS>.csv` | One per session, named from its first row |

Session CSV format (`\n` line endings):

```
# <firmware, newlines replaced by " | "> | moxy-web v1.0
# year assumed from --year / today's date; device log stores mm-dd only
date,time,smo2_live,smo2_avg,thb,lap,extra
2026-10-27,09:05:01,62,62,12.33,0,
```

If the folder already exists the page refuses and asks for a different participant code or date. It never overwrites a file. If no complete recordings are found, the raw and device-info files are still saved: send them to the maintainer and do not erase the sensor.

## Demo mode

Open `index.html?demo=1`. A banner reads "Demo mode: simulated sensor" and a fake serial port answers the full command sequence from `tests/fixtures/ringbuffer.txt`, sending bytes in irregular chunks with delays. The fake sensor clock runs 3 minutes 10 seconds slow, so the clock warning shows. Files are written to whatever folder you choose, so use a scratch folder.

For testing error messages: `?demo=1&scenario=nopick` (port picker closed), `scenario=busy` (port in use), `scenario=silent` (sensor never answers).

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, branch **`main`**, folder **`/ (root)`**, and click **Save**.
4. After a minute the page is live at `https://<user>.github.io/<repository>/`. GitHub Pages serves HTTPS, which Web Serial needs.

Only `index.html` is needed at runtime. Everything else is source, tests and documentation.

## Development

- `moxy-core.js` holds all parsing, session splitting and file formatting as pure functions. `index.html` carries a verbatim copy, plus the demo fixture and the base64 fonts. After editing `moxy-core.js`, a fixture or a font, run `node tools/sync.mjs`. A test fails if the copies differ.
- `tools/make_fixtures.py` regenerates the raw dumps in `tests/fixtures/`.
- Fonts: Atkinson Hyperlegible and IBM Plex Mono, latin subset, regular and bold, under the SIL Open Font License (`tools/fonts/`).

## Running the tests

Requirements: Python 3, Node 18 or later, and Playwright with Chromium (`npm install && npx playwright install chromium`). The reference script **`moxy_dump.py` must be in the repository root**.

```
npm test
```

This runs:

1. `python3 tests/parity.py`: imports `parse_line` and `split_sessions` from `moxy_dump.py` and writes the expected session CSVs for each fixture to `tests/expected/` (not committed).
2. `tests/parity.test.mjs`: runs `moxy-core.js` on the same raw dumps with a fixed "today" (2026-10-29) and compares every file **byte for byte**. Also checks the copy of the core inside `index.html`, plus unit tests for the helpers.
3. `tests/e2e.test.mjs`: runs the whole flow in demo mode in headless Chromium with a stubbed folder picker writing to a temporary directory, and checks the written files match the parity outputs and the raw fixture exactly. Also checks the error messages, the erase guard, refusal of an existing folder, the unsupported-browser message, and that there is no horizontal scrolling at 1280 and 400 px in light and dark.

The fixtures cover: out-of-order ring-buffer rows, `,,,,,` and ` ,,,,,` delimiter lines, non-zero-padded times, 5-, 7- and 8-field lines, quoted fields, mm-dd later than today (year rollover), a session across New Year, two sessions separated by more than 30 minutes, gaps of exactly 30 minutes inside a session, a session below the minimum rows, invalid dates and garbage lines.

## Sensor protocol

Verified from `moxy_dump.py` and GoldenCheetah's open-source `MoxyDevice.cpp`.

- USB virtual COM port, **115200 baud**, 8N1. After opening, DTR and RTS are set (pyserial's defaults).
- Plain-text console. Commands end with `\r` (CR only). Replies end with the prompt `>`.
- **Wake:** send `\r`, read until the reply (trailing whitespace stripped) ends with `>` or 2 s of silence. Up to 5 tries.
- **Info:** `ver` (firmware), `time` (sensor clock), `batt` (battery), `um` (update mode). Each read until `>` or 3 s idle; the echoed command and the prompt are removed. About 100 ms wait before every write.
- **Download:** `gd`. Every byte is kept. Stops when the last 64 bytes contain `\r\n` and end with `>` (trailing whitespace stripped), or 5 s idle once data has started, or 10 s with no data.
- **Leave:** `exit`, then close the port.
- **Erase:** `cd` erases all stored data. Wait 3 s, then `exit`. Reachable only through the guarded erase panel.
- No other command is ever sent.

### Log format

Each data line is `M-D,h:m:s,SmO2_live,SmO2_avg,THb,lap[,extra]`: month-day with no year, not zero-padded (`10-27,9:5:3,61,62,12.31,0`).

- Skipped: empty lines, lines of only commas and spaces, and lines not matching `^\s*(\d{1,2})-(\d{1,2}),(\d{1,2}):(\d{1,2}):(\d{1,2}),(.*)$`.
- Fields after the time are split on commas, trimmed of whitespace and double quotes, and padded or truncated to 5 (`smo2_live, smo2_avg, thb, lap, extra`).
- Year: the "Year of recording"; if that makes the date later than today, the year before. Invalid dates are skipped.
- The log is a ring buffer, so rows are sorted by timestamp.
- A gap of more than *gap* minutes (default 30) starts a new session. Sessions with fewer than *minimum rows* (default 30) are dropped.
