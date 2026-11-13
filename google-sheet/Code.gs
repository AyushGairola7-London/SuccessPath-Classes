/**
 * SuccessPath Classes: Google Sheet sync and backups
 * ===================================================
 *
 * Paste this whole file into your Google Sheet:
 *   Extensions > Apps Script > delete what is there > paste > Save.
 * Then reload the spreadsheet and use the new "SuccessPath" menu > "Connect to the app".
 *
 * What it does, by itself:
 *   - Every 5 minutes: copies new entries (and cancellations) from the app's database into the tabs.
 *   - Every night at about 2 AM India time:
 *       1. saves a full backup of the database (.json) and an Excel copy of this sheet (.xlsx)
 *          in the Google Drive folder "SuccessPath Backups",
 *       2. rebuilds every tab from the database, which undoes any accidental edits or deletions here.
 *     Daily backups are kept for 60 days; the backup from the 1st of each month is kept for good.
 *
 * The app's database is the master copy. Do not type in the data tabs; make your own tabs for
 * notes and totals, for example:  =SUMIFS(Fees!F:F, Fees!B:B, "Active")
 */

const SETTINGS = {
  TIMEZONE: 'Asia/Kolkata',
  LOCALE: 'en_IN',
  SYNC_EVERY_MINUTES: 5, // allowed: 1, 5, 10, 15 or 30
  NIGHTLY_HOUR: 2, // in TIMEZONE
  BACKUP_FOLDER: 'SuccessPath Backups',
  KEEP_DAILY_BACKUPS_DAYS: 60,
  ABOUT_TAB: 'About',
  SYNC_PAGE_SIZE: 100, // the app sends at most 150 at a time
  EXPORT_PAGE_SIZE: 100,
  FAILURES_BEFORE_EMAIL: 6, // Google emails you about failed runs; this avoids emails for short blips
};

const MANAGED_NOTE = 'Filled in by the SuccessPath app. Changes made here are undone at the next rebuild.';

/* ================================================================== */
/* Menu                                                                */
/* ================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SuccessPath')
    .addItem('Connect to the app', 'connectToApp')
    .addItem('Sync now', 'syncNowFromMenu')
    .addItem('Rebuild all tabs from the database', 'rebuildFromMenu')
    .addItem('Back up now', 'backupFromMenu')
    .addSeparator()
    .addItem('Show status', 'showStatus')
    .addToUi();
}

function connectToApp() {
  const ui = SpreadsheetApp.getUi();
  const urlAnswer = ui.prompt(
    'Connect to the app (step 1 of 2)',
    'Paste the app link, for example https://successpath.yourname.workers.dev',
    ui.ButtonSet.OK_CANCEL);
  if (urlAnswer.getSelectedButton() !== ui.Button.OK) return;
  const appUrl = cleanUrl_(urlAnswer.getResponseText());
  if (!appUrl) {
    ui.alert('That is not a web link', 'Start again and paste the whole link, beginning with https://', ui.ButtonSet.OK);
    return;
  }
  const keyAnswer = ui.prompt(
    'Connect to the app (step 2 of 2)',
    'Paste the sync key (the one you saved with "npx wrangler secret put SYNC_KEY").',
    ui.ButtonSet.OK_CANCEL);
  if (keyAnswer.getSelectedButton() !== ui.Button.OK) return;
  const key = keyAnswer.getResponseText().trim();

  const test = callApi_(appUrl, key, '/api/sync?after=0&limit=1');
  if (!test.ok) {
    ui.alert('Could not connect', test.error, ui.ButtonSet.OK);
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try { ss.setSpreadsheetTimeZone(SETTINGS.TIMEZONE); } catch (e) { /* keep the current time zone */ }
  try { ss.setSpreadsheetLocale(SETTINGS.LOCALE); } catch (e) { /* keep the current locale */ }
  sheetZoneCache_ = null;
  const props = PropertiesService.getScriptProperties();
  props.setProperties({ APP_URL: appUrl, SYNC_KEY: key, FAILS_IN_A_ROW: '0', LAST_ERROR: '' });
  props.deleteProperty('LAST_LOG_ID');
  props.deleteProperty('SCHEMA_SIG');
  installTriggers_();

  ss.toast('Copying all entries into the sheet…', 'SuccessPath', 10);
  try {
    const ran = withLock_(60000, function () {
      rebuildAll_(config_(), null);
      noteSuccess_();
      writeAbout_();
    });
    if (!ran) throw new Error('Another sync was running. Use SuccessPath > Sync now in a minute.');
  } catch (err) {
    ui.alert('Connected, but the first copy failed', messageOf_(err), ui.ButtonSet.OK);
    return;
  }
  ui.alert('Connected',
    'The sheet is linked to the app. New entries appear here within ' + SETTINGS.SYNC_EVERY_MINUTES +
    ' minutes, and a backup is saved to Google Drive every night.',
    ui.ButtonSet.OK);
}

function syncNowFromMenu() {
  runFromMenu_('Sync', function () {
    syncChanges_(config_(), true);
    noteSuccess_();
    writeAbout_();
    SpreadsheetApp.getActiveSpreadsheet().toast('All tabs are up to date.', 'SuccessPath', 5);
  });
}

function rebuildFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Rebuild all tabs?',
    'Every data tab is cleared and filled again from the database. Anything typed into those tabs ' +
    'is replaced. Your own tabs are not touched.', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  runFromMenu_('Rebuild', function () {
    rebuildAll_(config_(), null);
    noteSuccess_();
    writeAbout_();
    SpreadsheetApp.getActiveSpreadsheet().toast('All tabs were rebuilt from the database.', 'SuccessPath', 5);
  });
}

function backupFromMenu() {
  runFromMenu_('Backup', function () {
    const cfg = config_();
    const dump = fetchEverything_(cfg);
    const saved = saveBackup_(dump);
    saveExcelCopy_(saved.folder, saved.stamp);
    cfg.props.setProperty('LAST_BACKUP_AT', new Date().toISOString());
    writeAbout_();
    const ui = SpreadsheetApp.getUi();
    ui.alert('Backup saved',
      dump.entries.length + ' entries were saved to the Google Drive folder "' + SETTINGS.BACKUP_FOLDER + '":\n' +
      saved.folder.getUrl(), ui.ButtonSet.OK);
  });
}

function showStatus() {
  const p = PropertiesService.getScriptProperties().getProperties();
  const lines = [
    'App link: ' + (p.APP_URL || 'not connected'),
    'Last checked for new entries: ' + when_(p.LAST_SYNC_AT),
    'Last full rebuild: ' + when_(p.LAST_REBUILD_AT),
    'Last backup to Google Drive: ' + when_(p.LAST_BACKUP_AT),
    'Backup folder: ' + (p.BACKUP_FOLDER_URL || 'made at the first backup'),
    'Problems: ' + (p.LAST_ERROR || 'none'),
  ];
  const ui = SpreadsheetApp.getUi();
  ui.alert('SuccessPath status', lines.join('\n'), ui.ButtonSet.OK);
}

/* ================================================================== */
/* Runs by itself (set up by "Connect to the app")                     */
/* ================================================================== */

/** Every few minutes: copy new entries and changes into the tabs. */
function syncNow() {
  withLock_(10000, function () {
    try {
      syncChanges_(config_(), true);
      noteSuccess_();
    } catch (err) {
      const fails = noteProblem_('Sync', err);
      writeAbout_();
      if (fails >= SETTINGS.FAILURES_BEFORE_EMAIL) throw err;
      return;
    }
    writeAbout_();
  });
}

/** Every night: back up, then rebuild every tab from the database. */
function nightly() {
  withLock_(120000, function () {
    const cfg = config_();
    let dump;
    try {
      dump = fetchEverything_(cfg);
    } catch (err) {
      noteProblem_('Nightly backup', err);
      writeAbout_();
      throw err;
    }
    const problems = [];
    let saved = null;
    try {
      saved = saveBackup_(dump);
      cfg.props.setProperty('LAST_BACKUP_AT', new Date().toISOString());
    } catch (err) {
      problems.push('backup file: ' + messageOf_(err));
    }
    try {
      rebuildAll_(cfg, dump);
    } catch (err) {
      problems.push('rebuild: ' + messageOf_(err));
    }
    if (saved) {
      try { saveExcelCopy_(saved.folder, saved.stamp); } catch (err) { problems.push('Excel copy: ' + messageOf_(err)); }
      try { pruneBackups_(saved.folder); } catch (err) { problems.push('removing old backups: ' + messageOf_(err)); }
    }
    if (problems.length) {
      const err = new Error('Nightly run had problems with ' + problems.join('; '));
      noteProblem_('Nightly', err);
      writeAbout_();
      throw err;
    }
    noteSuccess_();
    writeAbout_();
  });
}

/* ================================================================== */
/* Copying data into the tabs                                          */
/* ================================================================== */

function syncChanges_(cfg, mayRebuild) {
  const stored = cfg.props.getProperty('LAST_LOG_ID');
  if (stored === null || stored === '') {
    if (!mayRebuild) throw new Error('The sheet has not been filled yet.');
    rebuildAll_(cfg, null);
    return;
  }
  let after = Number(stored) || 0;
  const signature = cfg.props.getProperty('SCHEMA_SIG');
  for (let page = 0; page < 100; page++) {
    const res = callApi_(cfg.appUrl, cfg.key, '/api/sync?after=' + after + '&limit=' + SETTINGS.SYNC_PAGE_SIZE);
    if (!res.ok) throw new Error(res.error);
    const body = res.body;
    if (schemaSignature_(body.schema) !== signature || !tabsExist_(body.schema)) {
      // The forms changed (a field was added) or a tab was deleted: rebuild everything.
      if (!mayRebuild) throw new Error('The tabs do not match the app. Use SuccessPath > Rebuild all tabs.');
      rebuildAll_(cfg, null);
      return;
    }
    if (body.changes.length) applyChanges_(body.schema, body.changes);
    after = body.next_after;
    cfg.props.setProperty('LAST_LOG_ID', String(after));
    if (!body.has_more) break;
  }
  cfg.props.setProperty('LAST_SYNC_AT', new Date().toISOString());
}

function rebuildAll_(cfg, dump) {
  const data = dump || fetchEverything_(cfg);
  writeAllTabs_(data.schema, data.entries);
  cfg.props.setProperties({
    LAST_LOG_ID: String(data.maxLogId),
    SCHEMA_SIG: schemaSignature_(data.schema),
    LAST_REBUILD_AT: new Date().toISOString(),
    TOTAL_ENTRIES: String(data.entries.length),
  });
  // Pick up anything saved while the rebuild was running.
  syncChanges_(cfg, false);
}

function fetchEverything_(cfg) {
  const entries = [];
  let after = 0;
  let first = null;
  for (let page = 0; page < 1000; page++) {
    const res = callApi_(cfg.appUrl, cfg.key, '/api/export?after_id=' + after + '&limit=' + SETTINGS.EXPORT_PAGE_SIZE);
    if (!res.ok) throw new Error(res.error);
    const body = res.body;
    if (!first) first = body;
    for (let i = 0; i < body.entries.length; i++) entries.push(body.entries[i]);
    after = body.next_after_id;
    if (!body.has_more) break;
  }
  entries.sort(function (a, b) { return a.id - b.id; });
  return { schema: first.schema, maxLogId: first.max_log_id, exportedAt: first.exported_at, entries: entries };
}

function writeAllTabs_(schema, entries) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  aboutSheet_(ss);
  const byType = {};
  schema.tabs.forEach(function (tab) { byType[tab.type] = []; });
  entries.forEach(function (entry) { if (byType[entry.type]) byType[entry.type].push(entry); });

  schema.tabs.forEach(function (tab) {
    const sheet = ss.getSheetByName(tab.tab) || ss.insertSheet(tab.tab);
    const width = tab.columns.length;
    const rows = byType[tab.type]
      .sort(function (a, b) { return a.seq - b.seq; })
      .map(function (entry) { return entryToRow_(tab, entry); });
    sheet.clear();
    ensureSize_(sheet, rows.length + 1, width);
    sheet.getRange(1, 1, 1, width).setValues([tab.columns.map(function (c) { return c.label; })]);
    if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
    formatTab_(sheet, tab);
  });
}

function applyChanges_(schema, changes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = {};
  schema.tabs.forEach(function (tab) { tabs[tab.type] = tab; });
  const work = {};
  changes
    .slice()
    .sort(function (a, b) { return a.log_id - b.log_id; })
    .forEach(function (change) {
      const entry = change.entry;
      const tab = entry ? tabs[entry.type] : null;
      if (!tab) return;
      let w = work[entry.type];
      if (!w) {
        const sheet = ss.getSheetByName(tab.tab);
        w = work[entry.type] = { tab: tab, sheet: sheet, rowOf: codeIndex_(sheet), appends: [], appendAt: {} };
      }
      const row = entryToRow_(tab, entry);
      if (w.rowOf[entry.code]) {
        w.sheet.getRange(w.rowOf[entry.code], 1, 1, row.length).setValues([row]);
      } else if (w.appendAt[entry.code] !== undefined) {
        w.appends[w.appendAt[entry.code]] = row;
      } else {
        w.appendAt[entry.code] = w.appends.length;
        w.appends.push(row);
      }
    });
  Object.keys(work).forEach(function (type) {
    const w = work[type];
    if (!w.appends.length) return;
    const start = w.sheet.getLastRow() + 1;
    if (ensureSize_(w.sheet, start + w.appends.length - 1, w.tab.columns.length)) formatTab_(w.sheet, w.tab);
    w.sheet.getRange(start, 1, w.appends.length, w.tab.columns.length).setValues(w.appends);
  });
}

function codeIndex_(sheet) {
  const rowOf = {};
  const last = sheet.getLastRow();
  if (last < 2) return rowOf;
  const codes = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) {
    if (codes[i][0] !== '' && codes[i][0] !== null) rowOf[String(codes[i][0])] = i + 2;
  }
  return rowOf;
}

function entryToRow_(tab, entry) {
  const data = entry.data || {};
  return tab.columns.map(function (column) {
    switch (column.key) {
      case '_code': return asText_(entry.code);
      case '_status': return asText_(entry.status);
      case '_saved_at': return asDateTime_(entry.created_at);
      case '_cancel_reason': return asText_(entry.cancel_reason);
      default: return cellValue_(column.kind, data[column.key]);
    }
  });
}

function cellValue_(kind, value) {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'date') return asDate_(value);
  if (kind === 'money') {
    const n = Number(value);
    return isFinite(n) ? n : asText_(value);
  }
  if (Array.isArray(value)) return asText_(value.join(', '));
  return asText_(value);
}

// The leading apostrophe makes Google Sheets keep the value exactly as typed: phone numbers keep
// their digits, "1/2" does not turn into a date, and nothing that starts with "=" can act as a formula.
function asText_(value) {
  if (value === null || value === undefined || value === '') return '';
  return "'" + String(value);
}

// A date such as 2026-11-13, made in the spreadsheet's own time zone so it shows the same day.
function asDate_(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return asText_(iso);
  return Utilities.parseDate(String(iso), sheetZone_(), 'yyyy-MM-dd');
}

let sheetZoneCache_ = null;
function sheetZone_() {
  if (!sheetZoneCache_) {
    try { sheetZoneCache_ = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); } catch (e) { /* use the default */ }
    if (!sheetZoneCache_) sheetZoneCache_ = SETTINGS.TIMEZONE;
  }
  return sheetZoneCache_;
}

function asDateTime_(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? asText_(iso) : d;
}

/* ================================================================== */
/* Tab layout                                                          */
/* ================================================================== */

function formatTab_(sheet, tab) {
  const width = tab.columns.length;
  const maxRows = sheet.getMaxRows();
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#E6ECF8').setFontColor('#17213A');
  if (tab.color) sheet.setTabColor(tab.color);
  tab.columns.forEach(function (column, i) {
    sheet.setColumnWidth(i + 1, columnWidth_(column.kind));
    const format = numberFormat_(column.kind);
    if (format && maxRows > 1) sheet.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat(format);
  });
  if (maxRows > 1) {
    const statusColumn = columnLetter_(indexOfKey_(tab.columns, '_status') + 1);
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + statusColumn + '2="Cancelled"')
      .setFontColor('#98A1B3')
      .setStrikethrough(true)
      .setRanges([sheet.getRange(2, 1, maxRows - 1, width)])
      .build();
    sheet.setConditionalFormatRules([rule]);
  }
  if (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length === 0) {
    sheet.protect().setDescription(MANAGED_NOTE).setWarningOnly(true);
  }
}

function numberFormat_(kind) {
  if (kind === 'date') return 'dd-mmm-yyyy';
  if (kind === 'timestamp') return 'dd-mmm-yyyy h:mm am/pm';
  if (kind === 'money') return '[$₹]#,##0';
  return null;
}

function columnWidth_(kind) {
  const widths = { code: 100, status: 90, date: 115, timestamp: 165, money: 105, phone: 120, textarea: 260, months: 170 };
  return widths[kind] || 150;
}

function ensureSize_(sheet, rows, columns) {
  let changed = false;
  if (sheet.getMaxRows() < rows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows() + 200);
    changed = true;
  }
  if (sheet.getMaxColumns() < columns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
    changed = true;
  }
  return changed;
}

function tabsExist_(schema) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return schema.tabs.every(function (tab) { return ss.getSheetByName(tab.tab) !== null; });
}

function aboutSheet_(ss) {
  let sheet = ss.getSheetByName(SETTINGS.ABOUT_TAB);
  if (sheet) return sheet;
  const blank = ss.getSheets().filter(function (s) {
    return /^(Sheet|Sheet 1|Sheet1)$/.test(s.getName()) && s.getLastRow() === 0 && s.getLastColumn() === 0;
  })[0];
  if (blank) {
    blank.setName(SETTINGS.ABOUT_TAB);
    return blank;
  }
  return ss.insertSheet(SETTINGS.ABOUT_TAB, 0);
}

function writeAbout_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = aboutSheet_(ss);
  const p = PropertiesService.getScriptProperties().getProperties();
  const rows = [
    ['SuccessPath Classes: records from the app', ''],
    ['This spreadsheet is filled in by the app. The app database is the master copy.', ''],
    ['Please do not type in the data tabs; changes there are put back every night. Make your own tabs for notes and totals.', ''],
    ['', ''],
    ['App link', p.APP_URL || 'Not connected yet'],
    ['Last checked for new entries', when_(p.LAST_SYNC_AT)],
    ['Last full rebuild', when_(p.LAST_REBUILD_AT)],
    ['Last backup to Google Drive', when_(p.LAST_BACKUP_AT)],
    ['Backup folder', p.BACKUP_FOLDER_URL || 'Made at the first backup'],
    ['Entries at the last rebuild', p.TOTAL_ENTRIES || ''],
    ['Problems', p.LAST_ERROR || 'None'],
  ];
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sheet.getRange(5, 1, rows.length - 4, 1).setFontWeight('bold');
  sheet.setColumnWidth(1, 240);
  sheet.setColumnWidth(2, 460);
}

/* ================================================================== */
/* Backups in Google Drive                                             */
/* ================================================================== */

function saveBackup_(dump) {
  const folder = backupFolder_();
  const stamp = Utilities.formatDate(new Date(), SETTINGS.TIMEZONE, 'yyyy-MM-dd HHmm');
  const payload = {
    app: 'SuccessPath Classes',
    kind: 'database backup',
    format: 1,
    exported_at: dump.exportedAt,
    max_log_id: dump.maxLogId,
    count: dump.entries.length,
    entries: dump.entries,
  };
  const name = 'SuccessPath database ' + stamp + '.json';
  folder.createFile(Utilities.newBlob(JSON.stringify(payload), 'application/json', name));
  return { folder: folder, stamp: stamp };
}

function saveExcelCopy_(folder, stamp) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SpreadsheetApp.flush();
  const response = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Google did not make the Excel copy (error ' + response.getResponseCode() + ').');
  }
  folder.createFile(response.getBlob().setName('SuccessPath sheet ' + stamp + '.xlsx'));
}

// Moves old daily backups to the Drive bin. Backups from the 1st of a month are kept.
function pruneBackups_(folder) {
  const cutoff = Date.now() - SETTINGS.KEEP_DAILY_BACKUPS_DAYS * 24 * 60 * 60 * 1000;
  const files = folder.getFiles();
  let removed = 0;
  while (files.hasNext()) {
    const file = files.next();
    const match = /^SuccessPath (database|sheet) \d{4}-\d{2}-(\d{2})/.exec(file.getName());
    if (!match || match[2] === '01') continue;
    if (file.getDateCreated().getTime() < cutoff) {
      file.setTrashed(true);
      removed++;
    }
  }
  return removed;
}

function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try {
      const existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (e) { /* the folder was deleted: make a new one */ }
  }
  const found = DriveApp.getFoldersByName(SETTINGS.BACKUP_FOLDER);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(SETTINGS.BACKUP_FOLDER);
  props.setProperties({ BACKUP_FOLDER_ID: folder.getId(), BACKUP_FOLDER_URL: folder.getUrl() });
  return folder;
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function config_() {
  const props = PropertiesService.getScriptProperties();
  const appUrl = props.getProperty('APP_URL');
  const key = props.getProperty('SYNC_KEY');
  if (!appUrl || !key) throw new Error('This sheet is not connected yet. Use SuccessPath > Connect to the app.');
  return { appUrl: appUrl, key: key, props: props };
}

function callApi_(appUrl, key, path) {
  let response;
  try {
    response = UrlFetchApp.fetch(appUrl + path, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + key },
      muteHttpExceptions: true,
      followRedirects: true,
    });
  } catch (err) {
    return { ok: false, error: 'Could not reach ' + appUrl + '. Check the link and the internet. (' + messageOf_(err) + ')' };
  }
  const code = response.getResponseCode();
  const text = response.getContentText();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (code === 200 && body && body.ok) return { ok: true, body: body };
  if (code === 401) return { ok: false, error: 'The sync key is wrong. Paste the same key you saved in Cloudflare (SYNC_KEY).' };
  if (code === 404) return { ok: false, error: 'This link does not look like the SuccessPath app: ' + appUrl };
  if (body && body.error) return { ok: false, error: body.error };
  return { ok: false, error: 'The app answered with error ' + code + '.' };
}

function cleanUrl_(text) {
  const url = String(text || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+\.[^\s/]+/.test(url) ? url.replace(/^(https:\/\/[^/]+).*$/, '$1') : '';
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const name = trigger.getHandlerFunction();
    if (name === 'syncNow' || name === 'nightly') ScriptApp.deleteTrigger(trigger);
  });
  const minutes = [1, 5, 10, 15, 30].indexOf(SETTINGS.SYNC_EVERY_MINUTES) >= 0 ? SETTINGS.SYNC_EVERY_MINUTES : 5;
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(minutes).create();
  ScriptApp.newTrigger('nightly').timeBased().atHour(SETTINGS.NIGHTLY_HOUR).everyDays(1)
    .inTimezone(SETTINGS.TIMEZONE).create();
}

function withLock_(waitMs, work) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) return false;
  try {
    work();
    return true;
  } finally {
    lock.releaseLock();
  }
}

function runFromMenu_(what, work) {
  const ui = SpreadsheetApp.getUi();
  try {
    const ran = withLock_(30000, work);
    if (!ran) ui.alert('Busy', 'The sheet is being updated right now. Try again in a minute.', ui.ButtonSet.OK);
  } catch (err) {
    noteProblem_(what, err);
    try { writeAbout_(); } catch (e) { /* ignore */ }
    ui.alert(what + ' did not finish', messageOf_(err), ui.ButtonSet.OK);
  }
}

function noteSuccess_() {
  PropertiesService.getScriptProperties().setProperties({ FAILS_IN_A_ROW: '0', LAST_ERROR: '' });
}

function noteProblem_(what, err) {
  const props = PropertiesService.getScriptProperties();
  const fails = (Number(props.getProperty('FAILS_IN_A_ROW')) || 0) + 1;
  props.setProperties({
    FAILS_IN_A_ROW: String(fails),
    LAST_ERROR: what + ' failed at ' + when_(new Date().toISOString()) + ': ' + messageOf_(err),
  });
  console.error(what + ' failed: ' + messageOf_(err));
  return fails;
}

function schemaSignature_(schema) {
  return JSON.stringify(schema.tabs.map(function (tab) {
    return [tab.type, tab.tab, tab.columns.map(function (c) { return c.label + ':' + c.kind; })];
  }));
}

function indexOfKey_(columns, key) {
  for (let i = 0; i < columns.length; i++) if (columns[i].key === key) return i;
  return 1;
}

function columnLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function when_(iso) {
  if (!iso) return 'Not yet';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Not yet';
  return Utilities.formatDate(d, SETTINGS.TIMEZONE, 'd MMM yyyy, h:mm a') + ' (India time)';
}

function messageOf_(err) {
  return err && err.message ? err.message : String(err);
}
