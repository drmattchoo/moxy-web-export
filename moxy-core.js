/*
 * moxy-core.js — pure parsing, session splitting and file formatting for
 * Moxy Web Export. No DOM, no I/O. Must behave exactly like parse_line and
 * split_sessions in moxy_dump.py v1.0 (checked by tests/parity.test.mjs).
 *
 * index.html carries a verbatim copy of this file between the
 * BEGIN/END moxy-core.js markers. Edit this file, then run
 * `node tools/sync.mjs` to update index.html.
 */
(function (root, factory) {
  'use strict';
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.MoxyCore = core;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 'moxy-web v1.0';
  const YEAR_COMMENT =
    "# year assumed from --year / today's date; device log stores mm-dd only";
  const CSV_HEADER = 'date,time,smo2_live,smo2_avg,thb,lap,extra';
  const LINE_RE = /^\s*(\d{1,2})-(\d{1,2}),(\d{1,2}):(\d{1,2}):(\d{1,2}),(.*)$/;
  const DELIMITER_RE = /^[,\s]*$/;
  const FIELD_COUNT = 5;

  const pad = (n, w = 2) => String(n).padStart(w, '0');

  // Calendar dates are plain {year, month, day} objects so that the
  // computer's time zone and daylight saving never shift a row.
  function isValidDate(year, month, day) {
    if (month < 1 || month > 12 || day < 1) return false;
    const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= dim;
  }

  function compareDates(a, b) {
    return (a.year - b.year) || (a.month - b.month) || (a.day - b.day);
  }

  function todayOf(d) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  function trimField(s) {
    return s.replace(/^[\s"]+|[\s"]+$/g, '');
  }

  /*
   * Parse one log line. Returns null for blank lines, delimiter lines
   * (",,,,," and " ,,,,,"), lines that do not match the log format, and
   * invalid dates. Otherwise returns a row:
   *   { t, date, time, fields: [smo2_live, smo2_avg, thb, lap, extra] }
   * where t is a sortable number (milliseconds, naive local time as UTC).
   */
  function parseLine(line, year, today) {
    if (DELIMITER_RE.test(line)) return null;
    const m = LINE_RE.exec(line);
    if (!m) return null;
    const month = +m[1], day = +m[2];
    const hh = +m[3], mm = +m[4], ss = +m[5];
    if (hh > 23 || mm > 59 || ss > 59) return null;

    let y = year;
    if (!isValidDate(y, month, day)) return null;
    if (compareDates({ year: y, month, day }, today) > 0) {
      y -= 1;
      if (!isValidDate(y, month, day)) return null;
    }

    const fields = m[6].split(',').map(trimField).slice(0, FIELD_COUNT);
    while (fields.length < FIELD_COUNT) fields.push('');

    return {
      t: Date.UTC(y, month - 1, day, hh, mm, ss),
      date: `${pad(y, 4)}-${pad(month)}-${pad(day)}`,
      time: `${pad(hh)}:${pad(mm)}:${pad(ss)}`,
      fields,
    };
  }

  function splitLines(text) {
    return text.split(/\r\n|\r|\n/);
  }

  // All valid rows of a dump, sorted by timestamp (stable for ties).
  function parseDump(text, year, today) {
    const rows = [];
    for (const line of splitLines(text)) {
      const row = parseLine(line, year, today);
      if (row) rows.push(row);
    }
    rows.sort((a, b) => a.t - b.t);
    return rows;
  }

  // Start a new session when consecutive rows are more than gapMinutes
  // apart; drop sessions with fewer than minRows rows. Rows must be sorted.
  function splitSessions(rows, gapMinutes = 30, minRows = 30) {
    const gapMs = gapMinutes * 60 * 1000;
    const sessions = [];
    let current = [];
    for (const row of rows) {
      if (current.length && row.t - current[current.length - 1].t > gapMs) {
        sessions.push(current);
        current = [];
      }
      current.push(row);
    }
    if (current.length) sessions.push(current);
    return sessions.filter((s) => s.length >= minRows);
  }

  function decodeBytes(bytes) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  // Quote like Python's csv.writer (QUOTE_MINIMAL).
  function csvField(s) {
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function firmwareLine(firmware) {
    return String(firmware || '').trim().replace(/\r\n|\r|\n/g, ' | ');
  }

  function sessionCsv(session, firmware) {
    let out = `# ${firmwareLine(firmware)} | ${VERSION}\n`;
    out += YEAR_COMMENT + '\n';
    out += CSV_HEADER + '\n';
    for (const r of session) {
      out += [r.date, r.time, ...r.fields].map(csvField).join(',') + '\n';
    }
    return out;
  }

  function sessionFilename(session) {
    const first = session[0];
    return `session_${first.date}_${first.time.replace(/:/g, '')}.csv`;
  }

  function summarise(session) {
    const first = session[0], last = session[session.length - 1];
    return {
      start: `${first.date} ${first.time}`,
      end: `${last.date} ${last.time}`,
      durationSeconds: Math.round((last.t - first.t) / 1000),
      rows: session.length,
      firstSmo2: first.fields[0],
      lastSmo2: last.fields[0],
    };
  }

  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h} h ${pad(m)} min` : `${m} min ${pad(s)} s`;
  }

  // ---- Names and stamps ----------------------------------------------

  const CODE_RE = /^[A-Za-z0-9-]+$/;

  function isValidCode(code) {
    return CODE_RE.test(code);
  }

  // date is "YYYY-MM-DD" from <input type="date">.
  function folderName(date, study, participant) {
    return `${date}_${study}_${participant}`;
  }

  function stamp(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // Local time without offset, like Python's datetime.now().isoformat().
  function localIso(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function hex4(n) {
    return n == null ? 'unknown' : '0x' + n.toString(16).padStart(4, '0');
  }

  function portLabel(info) {
    info = info || {};
    return `USB vendor ${hex4(info.usbVendorId)} product ${hex4(info.usbProductId)}`;
  }

  function deviceInfoText(info) {
    return [
      `firmware: ${info.firmware}`,
      `device_clock: ${info.deviceClock}`,
      `battery: ${info.battery}`,
      `update_mode: ${info.updateMode}`,
      `port: ${info.port}`,
      `script: ${VERSION}`,
      `downloaded_at: ${info.downloadedAt}`,
    ].join('\n') + '\n';
  }

  // ---- Console protocol helpers -------------------------------------

  function endsWithPrompt(text) {
    return text.replace(/\s+$/, '').endsWith('>');
  }

  // gd is complete when the last 64 bytes contain CRLF and, with trailing
  // whitespace stripped, end with the prompt.
  function gdComplete(bytes) {
    const tail = decodeBytes(bytes.subarray(Math.max(0, bytes.length - 64)));
    return tail.includes('\r\n') && endsWithPrompt(tail);
  }

  // Remove the echoed command and the trailing prompt from a reply.
  function cleanResponse(text, command) {
    let s = text.replace(/\s+$/, '');
    if (s.endsWith('>')) s = s.slice(0, -1);
    const lines = splitLines(s).map((l) => l.trim());
    while (lines.length && lines[0] === '') lines.shift();
    if (command && lines.length && lines[0] === command) lines.shift();
    return lines.filter((l) => l !== '').join('\n');
  }

  /*
   * Read the sensor clock reply. Accepts "M-D h:m:s", "M-D,h:m:s",
   * "YYYY-MM-DD hh:mm:ss" and "MM/DD/YYYY hh:mm:ss". Month-day replies take
   * the year from `now` (the previous year if that would be in the future).
   * Returns a Date in local time, or null.
   */
  function parseSensorClock(text, now) {
    const s = String(text || '');
    let m = /(\d{4})-(\d{1,2})-(\d{1,2})[ ,T]+(\d{1,2}):(\d{1,2}):(\d{1,2})/.exec(s);
    let y, mo, d, hh, mi, ss;
    if (m) {
      [y, mo, d, hh, mi, ss] = m.slice(1).map(Number);
    } else if ((m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ ,T]+(\d{1,2}):(\d{1,2}):(\d{1,2})/.exec(s))) {
      [mo, d, y, hh, mi, ss] = m.slice(1).map(Number);
      if (y < 100) y += 2000;
    } else if ((m = /(\d{1,2})-(\d{1,2})[ ,T]+(\d{1,2}):(\d{1,2}):(\d{1,2})/.exec(s))) {
      [mo, d, hh, mi, ss] = m.slice(1).map(Number);
      y = now.getFullYear();
      if (compareDates({ year: y, month: mo, day: d }, todayOf(now)) > 0) y -= 1;
    } else {
      return null;
    }
    if (!isValidDate(y, mo, d) || hh > 23 || mi > 59 || ss > 59) return null;
    return new Date(y, mo - 1, d, hh, mi, ss);
  }

  return {
    VERSION, YEAR_COMMENT, CSV_HEADER, LINE_RE,
    isValidDate, todayOf, parseLine, parseDump, splitSessions, decodeBytes,
    sessionCsv, sessionFilename, summarise, formatDuration,
    isValidCode, folderName, stamp, localIso, portLabel, deviceInfoText,
    endsWithPrompt, gdComplete, cleanResponse, parseSensorClock,
  };
});
