// 阅读模块页：书架。
//
// 「书架」= 一个你自己选的本地文件夹。书不复制、不上传 —— 我们只存一个指向它的
// 句柄（IndexedDB，见 library.js），读的时候现从磁盘取。所以关掉页面再打开，
// 书架还在，只是浏览器可能要你再确认一次读取权限。
//
// 选择文件夹需要支持 showDirectoryPicker 的浏览器及安全连接（HTTPS / localhost）。
// 普通 HTTP 或不支持的浏览器降级成「选一本书」：能读、能翻页，只是不记书架。
import * as View from "../view.js";
import { showToast } from "../typing/app.js";
import * as Model from "./reading-model.js";
import * as Library from "./library.js";
import { showReader, closeBook } from "./reader.js";

// 随应用附带的一本书，放在 public/ 里 —— 所以它在不在书架上，跟「有没有选
// 文件夹」无关：书架永远至少有这么一本，第一次进来也不是空的。
//
// 字节数固定填 0：这本书的身份取的是路径，不是内容。真实字节数写死在这里的话，
// 哪天换一个排版不同的同名 PDF，那个常数会悄悄变成谎话，进度也跟着丢。
const BUILTIN = {
  id: Model.bookId("builtin", "little-prince.pdf", 0),
  folder: "builtin",
  // name 是真文件名，和本地书架里那些书同一个形状 —— 读书页靠它认扩展名，
  // 决定走 PDF 还是 EPUB 那条路。书架上显示时前面加「内置」两个字。
  name: "little-prince.pdf",
  title: "小王子 The Little Prince",
  size: 0,
  builtin: true,
  url: "/books/little-prince.pdf"
};

const el = (id) => document.getElementById(id);

// IndexedDB 里有、但这次还没授权的那个文件夹。已经接上的那个不用记 ——
// 书就画在屏幕上，句柄用完即弃。落盘是 library.js 的事。
let stored = null;

function button(id, text, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.id = id;
  node.textContent = text;
  node.addEventListener("click", onClick);
  return node;
}

/* --------------------------------------------------------------------------
   画页面
   -------------------------------------------------------------------------- */

function layout() {
  const host = el("reading-view");
  host.textContent = "";

  const head = document.createElement("div");
  head.className = "page-head";
  const title = document.createElement("h2");
  title.textContent = "阅读";
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = Model.BOOK_EXTENSIONS.join(" / ").toUpperCase();
  head.append(title, note);

  const bar = document.createElement("div");
  bar.className = "shelf-bar";

  const folderName = document.createElement("span");
  folderName.className = "shelf-name";
  folderName.id = "reading-folder-name";

  // 单选文件这条降级路：input 光秃秃地摆在行里太丑，包进 label 当按钮用，
  // 和「选择书架文件夹」并排 —— 两条路摆在一起，用户自己挑能用的那条。
  const fileLabel = document.createElement("label");
  fileLabel.className = "shelf-file";
  const picker = document.createElement("input");
  picker.type = "file";
  picker.id = "reading-file";
  picker.accept = Model.BOOK_EXTENSIONS.map((ext) => `.${ext}`).join(",");
  picker.addEventListener("change", onPickFile);
  const fileText = document.createElement("span");
  fileText.textContent = "选一本书";
  fileLabel.append(picker, fileText);

  bar.append(button("reading-folder", "选择书架文件夹", chooseFolder), folderName, fileLabel);

  const shelfBox = document.createElement("div");
  shelfBox.className = "shelf";
  shelfBox.id = "reading-shelf";

  // 书架下面这一行专门放提示（还没选文件夹 / 授权过期 / 这个文件夹里没书）。
  // 和书架分开，是因为书架里永远有那本内置书 —— 提示不该把它挤掉。
  const noteBox = document.createElement("div");
  noteBox.id = "reading-note";

  host.append(head, bar, shelfBox, noteBox);
  // 先把内置书摆上。接书架要问 IndexedDB、可能还要问授权，都是异步的，
  // 在那之前书架不该是空的。
  paintBooks([]);
}

// 书架下面的提示只有一个样子：一句话，可能带一个按钮。传空字符串就清掉。
function paintNote(text, action) {
  const box = el("reading-note");
  if (!box) return;
  box.textContent = "";
  if (!text) return;
  const row = document.createElement("div");
  row.className = "shelf-note";
  const line = document.createElement("p");
  line.textContent = text;
  row.append(line);
  if (action) row.append(button(action.id, action.text, action.onClick));
  box.append(row);
}

function bookCell(book) {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "shelf-cell";

  const title = document.createElement("strong");
  title.className = "shelf-title";
  title.textContent = book.title;

  const file = document.createElement("span");
  file.className = "shelf-file-name";
  file.textContent = book.builtin ? `内置 · ${book.name}` : book.name;

  const progress = document.createElement("span");
  progress.className = "shelf-progress";
  // 进度是 B3 才写的，现在多半都是「未读」。这里先按同一套键读出来，
  // B3 一开始写，书架这行就自动有数了。
  progress.textContent = Model.progressLabel(localStorage.getItem(Model.progressKey(book.id)));

  cell.append(title, file, progress);
  cell.addEventListener("click", () => openEntry(book));
  return cell;
}

// 方格本里空着的一格 —— 读起来是纸，不是控件。
function blankCell() {
  const blank = document.createElement("div");
  blank.className = "shelf-cell blank";
  blank.setAttribute("aria-hidden", "true");
  return blank;
}

function paintBooks(books) {
  const box = el("reading-shelf");
  if (!box) return;
  box.textContent = "";
  const grid = document.createElement("div");
  grid.className = "shelf-grid";
  // 内置书永远排第一本，本地文件夹里的书接在后面。
  [BUILTIN].concat(books).forEach((book) => grid.append(bookCell(book)));
  // 补到 3 的整数倍：容器只画上边和左边、每格画自己的右边和下边，
  // 行不满外框就开缝。首页的方格本同一个做法。
  while (grid.children.length % 3 !== 0) grid.append(blankCell());
  box.append(grid);
}

function setFolderLabel(text, action) {
  const name = el("reading-folder-name");
  if (name) name.textContent = text;
  const folder = el("reading-folder");
  if (folder) folder.textContent = action;
}

/* --------------------------------------------------------------------------
   接线
   -------------------------------------------------------------------------- */

// 接上一个文件夹并把它里面的书列出来。授权不够或者目录读不动就抛，
// 由 connect() 兜住 —— 直接抛回事件处理器会变成一个没人看的 unhandled
// rejection，屏幕上什么都不发生。
async function attach(handle) {
  const entries = await Library.listEntries(handle);
  const handles = new Map(entries.map((entry) => [entry.name, entry.handle]));
  const books = Model.listBooks(handle.name, entries)
    .map((book) => ({ ...book, handle: handles.get(book.name) }));

  setFolderLabel(books.length ? `${handle.name} · ${books.length} 本` : handle.name, "换一个文件夹");
  paintBooks(books);

  if (!books.length) {
    paintNote(`这个文件夹里没有能打开的书。支持 ${Model.BOOK_EXTENSIONS.join(" / ").toUpperCase()}。`);
    return;
  }
  paintNote("");
}

async function connect(handle) {
  try {
    await attach(handle);
    return true;
  } catch {
    setFolderLabel("", "选择书架文件夹");
    paintBooks([]);
    paintNote("读不了这个文件夹。它可能被移动或者删掉了，重新选一个。");
    return false;
  }
}

async function chooseFolder() {
  let handle;
  try {
    handle = await Library.pickFolder();
  } catch (error) {
    // 在系统对话框里点了取消 —— 这不是故障，什么都不用说
    if (error && error.name === "AbortError") return;
    showToast("没能打开那个文件夹");
    return;
  }
  try {
    await Library.saveShelf(handle);
  } catch {
    // 句柄存不下不影响这一次（比如无痕模式），只是下次不会自动接上
  }
  await connect(handle);
}

// 句柄还在，但授权过期了。requestPermission 会弹窗，而且**必须由用户手势
// 触发** —— 所以只有真的点了「重新连接」才走这里。页面一打开就自动去要，
// 浏览器会直接拒掉，用户看到的是「上次的书架」永远连不上。
async function reconnect() {
  const handle = stored;
  if (!handle) return;
  const state = await Library.requestPermission(handle);
  if (!Library.isGranted(state)) {
    showToast("没有授权，读不了那个文件夹");
    return;
  }
  stored = null;
  await connect(handle);
}

// 每次进这个页面都重新接一次书架：句柄在 IndexedDB 里，授权状态只有问了才知道。
async function restoreShelf() {
  stored = null;

  if (!Library.supported()) {
    // 普通 HTTP 和不支持的浏览器均不暴露目录选择器，提示需区分原因。
    const folder = el("reading-folder");
    if (folder) folder.hidden = true;
    paintNote(window.isSecureContext
      ? "这个浏览器不能选文件夹，可尝试使用 Chrome / Edge。用「选一本书」照样能读，只是不记书架。"
      : "选择书架文件夹需要安全连接，请使用 HTTPS 地址。可先用「选一本书」继续阅读，只是不记书架。");
    return;
  }

  let handle = null;
  try {
    handle = await Library.loadShelf();
  } catch {
    handle = null;
  }
  if (!handle) {
    paintNote("还没有书架。选一个放着书的文件夹，里面的书会列在这里。");
    return;
  }

  if (Library.isGranted(await Library.permissionOf(handle))) {
    await connect(handle);
    return;
  }
  stored = handle;
  setFolderLabel(`上次的书架：${handle.name}`, "换一个文件夹");
  paintNote("浏览器要你再确认一次读取权限。", {
    id: "reading-reconnect", text: "重新连接", onClick: reconnect
  });
}

/* --------------------------------------------------------------------------
   打开书
   -------------------------------------------------------------------------- */

// 内置书随应用一起发布，是一段地址，不是磁盘上的文件句柄。取回来包成 File，
// 之后每一步（按扩展名分流、pdfjs 取 arrayBuffer）都和不内置的书走同一条路。
async function fetchAsFile(book) {
  const response = await fetch(book.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return new File([blob], book.name, { type: blob.type || "application/octet-stream" });
}

async function openEntry(book) {
  try {
    const source = book.url ? await fetchAsFile(book) : await book.handle.getFile();
    await showReader(source, book.title, book.id);
  } catch {
    // 内置书取不回来（离线、构建漏了文件）、或者本地书列出来之后被删掉或者移走了。
    // 打不开是故障不是批改，所以不用红色，而且书架还留在屏幕上 —— 可以直接点别的书。
    showToast(`打不开《${book.title}》`);
  }
}

async function onPickFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  // 单选这条路不记书架，但书名和身份照同一套规则取 —— 同一个文件再选一次，
  // 进度还是接得上。
  await showReader(file, Model.titleFromFilename(file.name), Model.bookId("", file.name, file.size));
  event.target.value = "";
}

export function showReading() {
  // 回到模块页就把书关掉：它的 iframe 留在隐藏容器里没有意义，而且
  // foliate 的 paginator 在尺寸为 0 的容器里会把自己的分页状态清空。
  closeBook();
  layout();
  View.setHeading("阅读", "书留在你自己的文件夹里，不上传。");
  View.show("reading");
  // 接书架要问 IndexedDB、可能还要问授权，都是异步的 —— 先让页面出来。
  // restoreShelf 自己吞掉所有失败，所以这里不用 await、也不会漏异常。
  restoreShelf();
}
