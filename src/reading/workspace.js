import * as View from "../view.js";
import { lookupWord, dictionaryPreview, renderDictionaryEntries, wordAtPoint } from "./dictionary.js";
import * as NotebookStore from "../notebook-store.js";

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function button(id, text, action) {
  const item = node("button", "reader-tool", text);
  item.type = "button";
  if (id) item.id = id;
  item.addEventListener("click", action);
  return item;
}

export function createWorkspace(host, { title, toolbar, stage, overlay, status, onPages, onToc, onWord }) {
  let active = "pages";
  let lookupToken = 0;
  let closed = false;
  let currentResult = null;
  const cleanups = [];
  let sidebarOpen = window.innerWidth > 760;
  try {
    const saved = localStorage.getItem("readerSidebar:guest");
    if (saved !== null && window.innerWidth > 760) sidebarOpen = saved !== "closed";
  } catch { /* 无痕模式照常阅读 */ }
  const shell = node("div", "reader-workspace");
  const header = node("header", "reader-workspace-header");
  const back = button("reader-back", "‹ 阅读书架", () => View.open("reading"));
  const name = node("span", "reader-workspace-title", title || "阅读");
  name.id = "reader-title";
  const toggle = button("reader-sidebar-toggle", "收起侧栏", () => setSidebar(!sidebarOpen));
  toggle.setAttribute("aria-controls", "reader-sidebar");
  header.append(back, name, toggle);
  const body = node("div", "reader-workspace-body");
  const sidebar = node("aside", "reader-sidebar");
  sidebar.id = "reader-sidebar";
  const tabs = node("div", "reader-sidebar-tabs");
  tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "阅读侧栏");
  const panels = {};
  const tabButtons = {};
  for (const [id, label] of [["pages", "页面"], ["toc", "目录"], ["dictionary", "词典"]]) {
    const tab = button(`reader-tab-${id}`, label, () => selectTab(id));
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `reader-side-${id}`);
    const panel = node("section", `reader-sidebar-panel reader-side-${id}`);
    panel.id = `reader-side-${id}`;
    panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", tab.id);
    panels[id] = panel; tabButtons[id] = tab;
    tabs.append(tab);
  }
  const dictionaryForm = node("form", "dictionary-search");
  const input = node("input");
  input.type = "search"; input.id = "dictionary-query";
  input.placeholder = "点击正文单词，或输入查词";
  input.setAttribute("aria-label", "查询单词"); input.maxLength = 100;
  const submit = node("button", "reader-tool", "查询"); submit.type = "submit";
  dictionaryForm.append(input, submit);
  dictionaryForm.addEventListener("submit", (event) => { event.preventDefault(); void showWord(input.value); });
  const dictionaryStatus = node("p", "reader-hint", "点击阅读区中的英文单词，即可查看本地词典释义与例句。扫描版 PDF 需要先有可选择的文字。");
  dictionaryStatus.id = "dictionary-status";
  dictionaryStatus.setAttribute("role", "status");
  const definition = node("div", "dictionary-definition"); definition.id = "dictionary-definition";
  const save = button("dictionary-save", "加入生词本", saveWord);
  save.hidden = true;
  const savedStatus = node("span", "dictionary-save-status");
  savedStatus.setAttribute("role", "status");
  const saveBar = node("div", "dictionary-save-bar"); saveBar.append(save, savedStatus);
  panels.dictionary.append(dictionaryForm, dictionaryStatus, saveBar, definition);
  definition.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("data-entry") || link.getAttribute("href") || "";
    if (href.startsWith("entry://")) void showWord(href.slice(8).split("#")[0]);
  });
  sidebar.append(tabs, ...Object.values(panels));
  const main = node("div", "reader-workspace-main");
  main.append(toolbar);
  if (overlay) main.append(overlay);
  if (status) main.append(status);
  main.append(stage);
  body.append(sidebar, main);
  const footer = node("footer", "reader-workspace-footer");
  footer.append(node("span", "", "点击单词查释义 · ← → 翻页"), node("span", "reader-footer-position"));
  shell.append(header, body, footer);
  host.replaceChildren(shell);

  function setSidebar(open, remember = true) {
    sidebarOpen = open;
    sidebar.hidden = !open;
    shell.classList.toggle("sidebar-closed", !open);
    toggle.textContent = open ? "收起侧栏" : "展开侧栏";
    toggle.setAttribute("aria-expanded", String(open));
    if (remember) try { localStorage.setItem("readerSidebar:guest", open ? "open" : "closed"); } catch { /* 可不记忆 */ }
  }
  function refresh() {
    if (active === "pages") { panels.pages.replaceChildren(); onPages?.(panels.pages); }
    if (active === "toc") { panels.toc.replaceChildren(); onToc?.(panels.toc); }
  }
  function selectTab(id, open = true) {
    active = id;
    for (const key of Object.keys(panels)) {
      panels[key].hidden = key !== active;
      tabButtons[key].setAttribute("aria-selected", String(key === active));
      tabButtons[key].classList.toggle("active", key === active);
    }
    if (open) setSidebar(true);
    refresh();
  }
  function savedNotes() { return NotebookStore.load().notes; }
  function updateSave() {
    const exists = savedNotes().some((note) => note.word.toLowerCase() === currentResult.matched.toLowerCase());
    save.disabled = exists;
    save.textContent = exists ? "已加入生词本" : "加入生词本";
  }
  function saveWord() {
    if (closed || !currentResult?.entries.length) return;
    try {
      const result = NotebookStore.addNote({ word: currentResult.matched,
        meaning: dictionaryPreview(currentResult).meaning,
        source: { type: "reading", title: title || "未命名书籍", query: currentResult.query } }, Date.now());
      if (!result.ok) {
        savedStatus.textContent = "未能保存，请重试。"; return;
      }
      updateSave(); savedStatus.textContent = "已收藏，可在首页的生词本查看。";
    } catch { savedStatus.textContent = "未能保存，请检查浏览器存储后重试。"; }
  }
  async function showWord(word) {
    const query = word.trim();
    if (!query || closed) return;
    const token = ++lookupToken;
    currentResult = null; save.hidden = true; savedStatus.textContent = "";
    selectTab("dictionary");
    input.value = query;
    definition.replaceChildren();
    dictionaryStatus.textContent = "正在查词…";
    onWord?.();
    try {
      const result = await lookupWord(query);
      if (closed || token !== lookupToken) return;
      if (!result || !result.entries.length) { dictionaryStatus.textContent = `本地词典未收录“${query}”。可输入单词原形再试。`; return; }
      dictionaryStatus.textContent = result.query === result.matched ? result.title : `${result.title} · 词形还原：${result.query} → ${result.matched}`;
      renderDictionaryEntries(definition, result);
      currentResult = result;
      save.hidden = false;
      updateSave();
    } catch (error) {
      if (!closed && token === lookupToken) dictionaryStatus.textContent = error.message || "查词失败，请稍后重试。";
    }
  }
  function bindWords(target, doc = target.ownerDocument || target, enabled = () => true) {
    const listener = (event) => {
      if (closed || !enabled() || document.body.dataset.view !== "reader" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest?.("a,button,input,textarea,select")) return;
      const word = wordAtPoint(doc, event);
      if (word) void showWord(word);
    };
    target.addEventListener("click", listener);
    cleanups.push(() => target.removeEventListener("click", listener));
  }
  setSidebar(sidebarOpen, false);
  selectTab("pages", false);
  return { shell, panels, selectTab, refresh, showWord, bindWords,
    position(text) { footer.querySelector(".reader-footer-position").textContent = text; },
    close() { closed = true; lookupToken += 1; for (const cleanup of cleanups) cleanup(); }
  };
}
