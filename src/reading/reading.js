// 阅读模块页。
//
// 第一步只有两件事：打开内置样本，或者打开你自己选的单个文件。
// 「记住一个目录当书架」是 B2 的事，「超纲词 / 朗读 / 搜索 / 排版」是 B4 往后。
import * as View from "../view.js";
import { showReader, closeBook } from "./reader.js";

const SAMPLE_URL = "/tests/fixtures/sample.epub";
const SAMPLE_NAME = "样本：Three Short Pieces";

const el = (id) => document.getElementById(id);

function button(id, text, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.id = id;
  node.textContent = text;
  node.addEventListener("click", onClick);
  return node;
}

function layout() {
  const host = el("reading-view");
  host.textContent = "";

  const head = document.createElement("div");
  head.className = "page-head";
  const title = document.createElement("h2");
  title.textContent = "阅读";
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "EPUB / MOBI / FB2 / CBZ";
  head.append(title, note);

  const sheet = document.createElement("section");
  sheet.className = "reader-chooser";

  const sampleRow = document.createElement("div");
  sampleRow.className = "reader-row";
  const sampleText = document.createElement("p");
  sampleText.textContent = "内置样本是一本三章的英文小书，用来先跑通整条路。";
  sampleRow.append(button("reading-sample", "打开样本", openSample), sampleText);

  const fileRow = document.createElement("div");
  fileRow.className = "reader-row";
  const fileText = document.createElement("p");
  fileText.textContent = "或者直接选一本书。选完就能读，不会记进书架。";
  const picker = document.createElement("input");
  picker.type = "file";
  picker.id = "reading-file";
  picker.accept = ".epub,.mobi,.azw3,.fb2,.cbz";
  picker.addEventListener("change", onPickFile);
  fileRow.append(picker, fileText);

  sheet.append(sampleRow, fileRow);
  host.append(head, sheet);
}

async function openSample() {
  await showReader(SAMPLE_URL, SAMPLE_NAME);
}

async function onPickFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  await showReader(file, file.name);
  event.target.value = "";
}

export function showReading() {
  // 回到模块页就把书关掉：它的 iframe 留在隐藏容器里没有意义，而且
  // foliate 的 paginator 在尺寸为 0 的容器里会把自己的分页状态清空。
  closeBook();
  layout();
  View.setHeading("阅读", "打开一本书，左右翻页。");
  View.show("reading");
}
