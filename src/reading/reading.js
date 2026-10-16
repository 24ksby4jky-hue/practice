// 阅读模块页：书架。
//
// 「书架」= 一个你自己选的本地文件夹。书不复制、不上传 —— 我们只存一个指向它的
// 句柄（IndexedDB，见 library.js），读的时候现从磁盘取。所以关掉页面再打开，
// 书架还在，只是浏览器可能要你再确认一次读取权限。
//
// 选择文件夹（showDirectoryPicker）只有 Chromium 系有。Firefox / Safari 里
// 那条路整个不存在，降级成下面那个「选一本书」：能读、能翻页，只是不记书架。
import * as View from "../view.js";
import { showToast } from "../typing/app.js";
import * as Model from "./reading-model.js";
import * as Library from "./library.js";
import { showReader, closeBook } from "./reader.js";

const SAMPLE_URL = "/tests/fixtures/sample.epub";
const SAMPLE_NAME = "样本：Three Short Pieces";
// 样本也要有身份，否则它的进度没法记。字节数不好拿，固定填 0 —— 样本是我们
// 自己生成的，不会偷偷换一个大小不同的版本。
const SAMPLE_ID = Model.bookId("sample", "sample.epub", 0);

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

  const sampleRow = document.createElement("div");
  sampleRow.className = "reader-row";
  const sampleText = document.createElement("p");
  sampleText.textContent = "内置样本是一本三章的英文小书，用来先跑通整条路。";
  sampleRow.append(button("reading-sample", "打开样本", openSample), sampleText);

  host.append(head, bar, shelfBox, sampleRow);
}

// 书架区只有三种样子：一排书格、一句提示（可能带一个按钮）、或者空着。
function paintMessage(text, action) {
  const box = el("reading-shelf");
  if (!box) return;
  box.textContent = "";
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
  file.textContent = book.name;

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
  books.forEach((book) => grid.append(bookCell(book)));
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

  if (!books.length) {
    paintMessage("这个文件夹里没有能打开的书。支持 EPUB / MOBI / AZW3 / FB2 / CBZ。");
    return;
  }
  paintBooks(books);
}

async function connect(handle) {
  try {
    await attach(handle);
    return true;
  } catch {
    setFolderLabel("", "选择书架文件夹");
    paintMessage("读不了这个文件夹。它可能被移动或者删掉了，重新选一个。");
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
    // Firefox / Safari 没有目录选择器。把那条路整个藏掉，别放个点了没反应的按钮。
    const folder = el("reading-folder");
    if (folder) folder.hidden = true;
    paintMessage("这个浏览器不能选文件夹（Chrome / Edge 可以）。用「选一本书」照样能读，只是不记书架。");
    return;
  }

  let handle = null;
  try {
    handle = await Library.loadShelf();
  } catch {
    handle = null;
  }
  if (!handle) {
    paintMessage("还没有书架。选一个放着书的文件夹，里面的书会列在这里。");
    return;
  }

  if (Library.isGranted(await Library.permissionOf(handle))) {
    await connect(handle);
    return;
  }
  stored = handle;
  setFolderLabel(`上次的书架：${handle.name}`, "换一个文件夹");
  paintMessage("浏览器要你再确认一次读取权限。", {
    id: "reading-reconnect", text: "重新连接", onClick: reconnect
  });
}

/* --------------------------------------------------------------------------
   打开书
   -------------------------------------------------------------------------- */

async function openEntry(book) {
  try {
    // 列目录时只取了名字和大小，内容是这一刻才从磁盘读的
    const file = await book.handle.getFile();
    await showReader(file, book.title, book.id);
  } catch {
    // 列出来之后文件被删掉或者移走了。打不开是故障不是批改，所以不用红色，
    // 而且书架还留在屏幕上 —— 用户可以直接点别的书。
    showToast(`打不开《${book.title}》`);
  }
}

async function openSample() {
  await showReader(SAMPLE_URL, SAMPLE_NAME, SAMPLE_ID);
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
