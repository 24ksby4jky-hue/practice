import { persistJson } from "./typing/app.js";
import * as Model from "./notebook-model.js";
import * as Daily from "./notebook-daily-model.js";

// 生词本的唯一读写入口。键名仍然只在 notebook-model.js 里定义一次。
const KEY = Model.NOTE_KEY;

// 写盘失败时（配额满、私密模式、站点存储被禁）把最新一版留在内存里。
// 不这样做的话，下一次「读 → 改 → 写」会拿到旧数据，刚判的那几个词就白丢了。
let memoryStore = null;
let lastSaveOk = true;
let lastChars = 0;

function readRaw() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function load() {
  if (memoryStore) return memoryStore;
  const raw = readRaw();
  lastChars = typeof raw === "string" ? raw.length : 0;
  return Model.readStore(raw);
}

function save(store) {
  const next = Model.pruneStore(store, Model.todayDay());
  const ok = persistJson(KEY, next);
  lastSaveOk = ok;
  if (ok) {
    memoryStore = null;
    lastChars = Model.storeChars(next);
  } else {
    memoryStore = next;
  }
  return { store: next, ok };
}

// 读 → 改 → 写一次性完成，中间不把 store 留在 UI 状态里 ——
// 别的标签页同时写这个键时，窗口期越短越好。
function update(mutator) {
  const current = load();
  const next = typeof mutator === "function" ? mutator(current) : current;
  return save(next && typeof next === "object" ? next : current);
}

function addNote(entry, atMs) {
  return update((store) => Model.addNoteToStore(store, entry, Number.isFinite(atMs) ? atMs : Date.now()));
}

function setLevel(word, level) {
  return update((store) => Model.setLevelInStore(store, word, level));
}

function remove(word) {
  return update((store) => Model.removeNoteFromStore(store, word));
}

function clear() {
  return update((store) => Model.clearNotesInStore(store));
}

function setDailyCount(value) {
  return update((store) => Model.setDailyCount(store, value));
}

function notes() {
  return load().notes;
}

function exportText(atMs) {
  return JSON.stringify(Daily.exportPayload(load(), Number.isFinite(atMs) ? atMs : Date.now()), null, 2);
}

function parseImport(text) {
  return Daily.parseBackup(text);
}

function merge(importedStore) {
  return update((store) => Daily.mergeStores(store, importedStore));
}

// 超过提示线才提醒导出，不是硬性上限 —— 到配额真的满了才写不进去，
// 那时内存兜底会接住，不会丢正在判的这一轮。
function sizeWarning() {
  const chars = memoryStore ? Model.storeChars(memoryStore) : lastChars;
  return chars > Model.SOFT_SIZE_CHARS;
}

function status() {
  return {
    ok: lastSaveOk,
    pending: Boolean(memoryStore),
    chars: memoryStore ? Model.storeChars(memoryStore) : lastChars
  };
}

function download(text, filename) {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立刻 revoke 在部分浏览器上会打断下载，放到下一轮事件循环。
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export {
  KEY, load, save, update, addNote, setLevel, remove, clear, setDailyCount,
  notes, exportText, parseImport, merge, sizeWarning, status, download
};
