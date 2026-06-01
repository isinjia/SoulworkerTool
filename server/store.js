const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const DATA_FILE_TMP = path.join(DATA_DIR, 'db.json.tmp');
const SAVE_MAX_RETRIES = 5;
const SAVE_RETRY_BASE_MS = 80;

let isSaving = false;
let saveAgain = false;

function sleepSync(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* retry backoff */ }
}

function isRetryableFsError(err) {
  if (!err) return false;
  const code = err.code;
  if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOENT') return true;
  if (code === 'UNKNOWN' || (err.message && /unknown error/i.test(err.message))) return true;
  return false;
}

function isWindowsReplaceFallbackError(err) {
  if (!err) return false;
  const code = err.code;
  return code === 'EPERM' || code === 'EXDEV' || code === 'EACCES' || code === 'EBUSY' || code === 'UNKNOWN';
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) {
    return {
      authUsers: {},
      pendingFirstRequests: [],
      pendingClear1stRequests: [],
      pendingDueDateChangeRequests: [],
      workHistory: [],
      localTasks: [],
      commentsByTaskId: {}
    };
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return {
      authUsers: {},
      pendingFirstRequests: [],
      pendingClear1stRequests: [],
      pendingDueDateChangeRequests: [],
      workHistory: [],
      localTasks: [],
      commentsByTaskId: {}
    };
  }
}

function writeDbContentOnce(content) {
  fs.writeFileSync(DATA_FILE_TMP, content, { encoding: 'utf8', flag: 'w' });
  try {
    fs.renameSync(DATA_FILE_TMP, DATA_FILE);
  } catch (renameErr) {
    if (isWindowsReplaceFallbackError(renameErr)) {
      fs.writeFileSync(DATA_FILE, content, { encoding: 'utf8', flag: 'w' });
      if (fs.existsSync(DATA_FILE_TMP)) fs.unlinkSync(DATA_FILE_TMP);
      return;
    }
    throw renameErr;
  }
}

function writeDbContentWithRetry(content) {
  let lastErr;
  for (let attempt = 0; attempt < SAVE_MAX_RETRIES; attempt++) {
    try {
      writeDbContentOnce(content);
      return;
    } catch (err) {
      lastErr = err;
      try {
        if (fs.existsSync(DATA_FILE_TMP)) fs.unlinkSync(DATA_FILE_TMP);
      } catch (_) {}
      if (!isRetryableFsError(err) || attempt >= SAVE_MAX_RETRIES - 1) break;
      sleepSync(SAVE_RETRY_BASE_MS * (attempt + 1));
    }
  }
  const msg = lastErr && lastErr.code
    ? `[${lastErr.code}] ${lastErr.message}`
    : (lastErr && lastErr.message) || 'Unknown error';
  throw new Error(
    `DB 저장 실패: ${msg}. data 폴더 권한, 디스크 여유 공간, OneDrive/백신 잠금, 서버 중복 실행 여부를 확인하세요.`
  );
}

function persistDb(snapshot) {
  ensureDir();
  const content = JSON.stringify(snapshot, null, 2);
  writeDbContentWithRetry(content);
}

function save(snapshot) {
  if (isSaving) {
    saveAgain = true;
    return;
  }
  isSaving = true;
  try {
    persistDb(snapshot);
    while (saveAgain) {
      saveAgain = false;
      persistDb(data);
    }
  } finally {
    isSaving = false;
  }
}

const data = load();

function get(key) {
  return data[key];
}

function set(key, value) {
  data[key] = value;
  save(data);
}

function update(keys, updater) {
  keys.forEach((k) => {
    data[k] = updater(data[k] ?? (k === 'authUsers' ? {} : k === 'localTasks' ? [] : k === 'commentsByTaskId' ? {} : []));
  });
  save(data);
}

module.exports = { get, set, update, load, save, data };
