# Changelog

## v1.0 — 2026-10-29

First release.

- Single-page app (`index.html`) that downloads the Moxy on-board log over Web Serial and writes it with the File System Access API. Works offline once loaded, with no install.
- Writes the same files as `moxy_dump.py` v1.0: `raw_gd_<stamp>.txt`, `device_info_<stamp>.txt` and one `session_<date>_<time>.csv` per session.
- Session details form with code validation and a live folder name. Refuses to use an existing folder and never overwrites a file.
- Shows firmware, sensor clock beside computer clock (flagged when more than 2 minutes apart), battery and update mode.
- Guarded erase: available only after this page saved a complete download with at least one session, needs `erase` typed, and checks the firmware reply matches the downloaded sensor.
- Advanced settings for session gap and minimum rows; timestamped console log that can be saved.
- Demo mode (`?demo=1`) with a simulated sensor.
- Tests: parser parity against `moxy_dump.py`, and a Playwright run of the whole demo flow.
