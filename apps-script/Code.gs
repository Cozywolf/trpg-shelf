/**
 * TRPG 藏書閣 — Google 試算表同步後端
 *
 * 用法：在你的 Google 試算表中選「擴充功能 → Apps Script」，
 * 把這整個檔案貼上，修改下面的 TOKEN，然後部署成「網頁應用程式」。
 * 詳細步驟見 https://github.com/Cozywolf/trpg-shelf
 */

// ★ 改成只有你知道的通關密語（App 設定頁要填一樣的）
const TOKEN = '請改成你自己的密語';

const SHEET_NAME = '藏書';
const COVER_FOLDER = 'TRPG藏書閣封面';

// 欄位代號 → 試算表標題。可以調整欄位順序，但請不要改標題文字。
const LABELS = {
  shelf: '流水號', title: '書名', titleAlt: '原文書名', system: '系統', kind: '類型',
  author: '作者', publisher: '出版社', isbn: 'ISBN', pubdate: '出版日期', edition: '版次',
  lang: '語言', tags: '標籤', note: '備註', where: '收藏位置', code: 'QR內容',
  needsReview: '待確認', coverUrl: '封面網址', createdAt: '建立時間', updatedAt: '更新時間', id: 'ID',
};
const KEYS = Object.keys(LABELS);
const TEXT_KEYS = ['isbn', 'pubdate', 'edition', 'code', 'title', 'titleAlt', 'note', 'author', 'publisher'];

const SCRIPT_VERSION = '2026-09-27c';

// App 查書目時，手機直接連線失敗會改由這裡代查；只允許這幾個書目資料庫
const FETCH_ALLOWED = /^https:\/\/(www\.googleapis\.com\/books\/|openlibrary\.org\/|api\.openbd\.jp\/)/;

function tokenReady_() {
  return typeof TOKEN === 'string' && TOKEN.trim().length > 0 && !/^請改/.test(TOKEN);
}

// 在瀏覽器直接打開部署網址，可以確認目前生效的版本與 TOKEN 是否已設定（不會顯示密語內容）
function doGet() {
  return json_({ ok: true, msg: 'TRPG 藏書閣 API 運作中', version: SCRIPT_VERSION, tokenSet: tokenReady_() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '無法解析請求' }); }
  if (!tokenReady_()) return json_({ ok: false, error: '請先在 Apps Script 裡設定 TOKEN（目前生效的版本：' + SCRIPT_VERSION + '）' });
  if (String(body.token || '').trim() !== TOKEN.trim()) return json_({ ok: false, error: '通關密語錯誤' });
  try {
    if (body.action === 'upload') return json_(upload_(body));
    if (body.action === 'fetch') return json_(fetch_(body));
    if (body.action === 'sync') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { return json_(sync_(body)); } finally { lock.releaseLock(); }
    }
    return json_({ ok: false, error: '未知的動作' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/** 在試算表手動修改時，自動更新「更新時間」，讓手機端拿到最新資料。 */
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NAME || e.range.getRow() < 2) return;
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = header.indexOf(LABELS.updatedAt) + 1;
  if (!col || (e.range.getColumn() <= col && col < e.range.getColumn() + e.range.getNumColumns())) return;
  sh.getRange(e.range.getRow(), col, e.range.getNumRows(), 1).setValue(Date.now());
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, KEYS.length).setValues([KEYS.map(k => LABELS[k])]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function header_(sh) {
  const lastCol = Math.max(1, sh.getLastColumn());
  let header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  while (header.length && header[header.length - 1] === '') header.pop();
  KEYS.forEach(k => {
    if (header.indexOf(LABELS[k]) < 0) {
      header.push(LABELS[k]);
      sh.getRange(1, header.length).setValue(LABELS[k]).setFontWeight('bold');
    }
  });
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  const idx = {};
  KEYS.forEach(k => idx[k] = header.indexOf(LABELS[k]));
  return { header, idx };
}

function cell_(k, v) {
  if (v === null || v === undefined) return '';
  if (k === 'tags') return Array.isArray(v) ? v.join('、') : String(v);
  if (k === 'needsReview') return v === true;
  if (k === 'shelf' || k === 'createdAt' || k === 'updatedAt') return Number(v) || '';
  const s = String(v);
  if (s && (TEXT_KEYS.indexOf(k) >= 0 || /^[=+\-@]/.test(s))) return "'" + s;
  return s;
}

function sync_(body) {
  const sh = sheet_();
  const { header, idx } = header_(sh);
  const width = header.length;
  const n = sh.getLastRow() - 1;
  let rows = n > 0 ? sh.getRange(2, 1, n, width).getValues() : [];
  const origLen = rows.length;
  let changed = false;

  // 在試算表手動新增、還沒有 ID 的列
  rows.forEach(r => {
    if (!r[idx.id] && r[idx.title]) {
      r[idx.id] = Utilities.getUuid();
      if (!r[idx.createdAt]) r[idx.createdAt] = Date.now();
      if (!r[idx.updatedAt]) r[idx.updatedAt] = Date.now();
      changed = true;
    }
  });

  // 保留原本的文字格式（避免 ISBN 等被轉成數字或日期）
  rows = rows.map(r => r.map((v, j) => {
    const k = KEYS.filter(key => idx[key] === j)[0];
    if (k && TEXT_KEYS.indexOf(k) >= 0 && v !== '' && !(v instanceof Date)) return "'" + String(v);
    if (v instanceof Date) return "'" + Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return v;
  }));

  const pos = {};
  rows.forEach((r, i) => { if (r[idx.id]) pos[String(r[idx.id])] = i; });

  (body.upserts || []).forEach(b => {
    if (!b || !b.id) return;
    const at = pos[String(b.id)];
    const row = at !== undefined ? rows[at] : null;
    if (row && Number(row[idx.updatedAt] || 0) > Number(b.updatedAt || 0)) return; // 試算表較新
    const target = row || new Array(width).fill('');
    KEYS.forEach(k => { target[idx[k]] = cell_(k, b[k]); });
    if (!row) { pos[String(b.id)] = rows.length; rows.push(target); }
    changed = true;
  });

  const del = {};
  (body.deletes || []).forEach(id => del[String(id)] = true);
  if (Object.keys(del).length) {
    const before = rows.length;
    rows = rows.filter(r => !del[String(r[idx.id])]);
    if (rows.length !== before) changed = true;
  }

  if (changed) {
    if (origLen > 0) sh.getRange(2, 1, origLen, width).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  }

  const books = rows.filter(r => r[idx.id]).map(r => {
    const o = {};
    KEYS.forEach(k => {
      let v = r[idx[k]];
      if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
      o[k] = v;
    });
    return o;
  });
  return { ok: true, books: books };
}

function fetch_(body) {
  const url = String(body.url || '');
  if (!FETCH_ALLOWED.test(url)) return { ok: false, error: '不允許的網址' };
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'TRPG-Shelf/1.0 (personal book catalog)' } });
  return { ok: true, status: res.getResponseCode(), body: res.getContentText() };
}

/** 更新程式後在編輯器執行一次這個函式，讓 Google 詢問新的權限（連線到外部網站）。 */
function authorize() {
  UrlFetchApp.fetch('https://openlibrary.org/', { muteHttpExceptions: true });
  SpreadsheetApp.getActiveSpreadsheet();
  DriveApp.getRootFolder();
  Logger.log('授權完成，目前版本：' + SCRIPT_VERSION);
}

function upload_(body) {
  if (!body.data) return { ok: false, error: '沒有圖片資料' };
  const it = DriveApp.getFoldersByName(COVER_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(COVER_FOLDER);
  const blob = Utilities.newBlob(Utilities.base64Decode(body.data), 'image/jpeg', (body.name || 'cover') + '.jpg');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: file.getId(), url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w600' };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
