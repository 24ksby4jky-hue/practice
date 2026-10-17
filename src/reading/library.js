// 本地文件夹书架 —— File System Access API + IndexedDB。
//
// 这一层刻意是薄的，而且不测（要真的浏览器和真的文件夹才能跑）：
// 它只做三件事 —— 让用户选一个文件夹、把目录里能读的书列出来、
// 把文件夹句柄存下来让下次接着用。所有判断（哪些文件算书、书名怎么取、
// 一本书的身份是什么）都在 reading-model.js 里，那部分才是有测试的。
//
// 平台差异：目录选择器需要浏览器支持和安全连接。普通 HTTP 和不支持的浏览器里
// window.showDirectoryPicker 是 undefined；调用方拿 false 就走单文件的降级路径。
//
// 书本身从来不进这里：不复制、不上传。我们只拿一个指向本地文件夹的句柄，
// 读的时候现从磁盘取。
import { isBookFile } from "./reading-model.js";

const DB_NAME = "reading-library";
const DB_VERSION = 1;
const STORE = "handles";
const SHELF_KEY = "shelf";

function supported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

// id 让 Chrome 记住上次选的是哪个目录，下次打开对话框直接落在那儿。
function pickFolder() {
  return window.showDirectoryPicker({ id: "reading-shelf", mode: "read" });
}

/* --------------------------------------------------------------------------
   句柄的持久化
   FileSystemDirectoryHandle 可以被结构化克隆，所以直接 put 就行 ——
   没有办法、也不需要自己序列化它。
   -------------------------------------------------------------------------- */

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 每个动作开一次连接再关掉。书架操作一天就那么几次，不值得维护长连接。
function run(mode, act) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = act(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  }));
}

function saveShelf(handle) {
  return run("readwrite", (store) => store.put(handle, SHELF_KEY));
}

function loadShelf() {
  return run("readonly", (store) => store.get(SHELF_KEY)).then((found) => found || null);
}

/* --------------------------------------------------------------------------
   授权
   句柄能跨会话留下来，但「读这个文件夹」的授权不一定还在。
   queryPermission 只查、不问；requestPermission 会弹窗，而且**必须由用户手势
   触发** —— 所以不能页面一开就自动去要，得等用户真的点了一下。
   -------------------------------------------------------------------------- */

function permissionOf(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return Promise.resolve("denied");
  return handle.queryPermission({ mode: "read" });
}

function requestPermission(handle) {
  if (!handle || typeof handle.requestPermission !== "function") return Promise.resolve("denied");
  return handle.requestPermission({ mode: "read" });
}

function isGranted(state) {
  return state === "granted";
}

/* --------------------------------------------------------------------------
   列目录
   -------------------------------------------------------------------------- */

// 目录 → [{ name, size, handle }]。只要文件，只要认识的格式。
async function listEntries(handle) {
  const entries = [];
  for await (const entry of handle.values()) {
    if (!entry || entry.kind !== "file" || !isBookFile(entry.name)) continue;
    let size = 0;
    try {
      // getFile() 只读元数据，不会把整本书读进来
      size = (await entry.getFile()).size;
    } catch {
      // 取不到大小就按 0 算 —— 书还在，只是身份少一段
    }
    entries.push({ name: entry.name, size, handle: entry });
  }
  return entries;
}

export {
  supported, pickFolder,
  saveShelf, loadShelf,
  permissionOf, requestPermission, isGranted,
  listEntries
};
