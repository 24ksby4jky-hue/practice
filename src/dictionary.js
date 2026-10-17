import * as View from "./view.js";
import * as Notebook from "./notebook-model.js";
import { persistJson } from "./typing/app.js";
import { normalizeDictionaryKey } from "./reading/dictionary-model.js";
import { lookupWord, dictionaryPreview, renderDictionaryEntries } from "./reading/dictionary.js";

const root = document.getElementById("dictionary-view");
root.innerHTML = `
  <div class="page-head">
    <h2>词典</h2>
    <button type="button" id="lexicon-notebook">查看生词本 ›</button>
  </div>
  <p class="hint">柯林斯高阶英汉双解学习词典 · 查释义、读例句、记生词</p>
  <form class="dictionary-search lexicon-search" role="search" aria-label="柯林斯词典">
    <label class="lexicon-label" for="lexicon-query">单词或短语</label>
    <input id="lexicon-query" type="search" placeholder="输入英文单词或短语，如 book" maxlength="100" autocomplete="off" spellcheck="false" required>
    <button type="submit">查询</button>
  </form>
  <p id="lexicon-status" class="hint" role="status">输入单词，按 Enter 查询。支持复数、过去式等常见词形。</p>
  <div class="lexicon-save-bar">
    <button type="button" id="lexicon-save" hidden>加入生词本</button>
    <span id="lexicon-save-status" class="hint" role="status"></span>
  </div>
  <div id="lexicon-definition" class="dictionary-definition" aria-label="词典注释" aria-busy="false"></div>
`;

const input = root.querySelector("#lexicon-query");
const status = root.querySelector("#lexicon-status");
const definition = root.querySelector("#lexicon-definition");
const save = root.querySelector("#lexicon-save");
const saveStatus = root.querySelector("#lexicon-save-status");
let currentResult = null;
let lookupToken = 0;

function savedNotes() {
  return Notebook.readNotes(localStorage.getItem(Notebook.NOTE_KEY));
}

function updateSave() {
  if (!currentResult) return;
  try {
    const exists = savedNotes().some((note) => note.word.trim().toLowerCase() === currentResult.matched);
    save.disabled = exists;
    save.textContent = exists ? "已加入生词本" : "加入生词本";
  } catch {
    save.disabled = false;
    save.textContent = "加入生词本";
  }
}

async function search(value) {
  const token = ++lookupToken;
  currentResult = null;
  save.hidden = true;
  saveStatus.textContent = "";
  definition.replaceChildren();
  definition.setAttribute("aria-busy", "false");
  const query = normalizeDictionaryKey(value);
  if (!query) {
    status.textContent = "请输入有效的英文单词或短语。";
    input.focus();
    return;
  }
  input.value = query;
  status.textContent = `正在查询“${query}”…`;
  definition.setAttribute("aria-busy", "true");
  try {
    const result = await lookupWord(query);
    if (token !== lookupToken) return;
    if (!result?.entries.length) {
      status.textContent = `柯林斯词典未收录“${query}”。请检查拼写，或尝试单词原形。`;
      return;
    }
    renderDictionaryEntries(definition, result);
    status.textContent = result.query === result.matched ? result.title
      : `${result.title} · 词形还原：${result.query} → ${result.matched}`;
    currentResult = result;
    save.hidden = false;
    updateSave();
  } catch (error) {
    if (token === lookupToken) status.textContent = `${error.message || "查词失败。"} 请稍后重新查询。`;
  } finally {
    if (token === lookupToken) definition.setAttribute("aria-busy", "false");
  }
}

root.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  void search(input.value);
});

save.addEventListener("click", () => {
  if (!currentResult) return;
  try {
    const next = Notebook.addNote(savedNotes(), {
      word: currentResult.matched,
      meaning: dictionaryPreview(currentResult).meaning
    }, Date.now());
    if (!persistJson(Notebook.NOTE_KEY, next)) {
      saveStatus.textContent = "未能保存，请重试。";
      return;
    }
    updateSave();
    saveStatus.textContent = "已加入生词本，可随时查看和复习。";
  } catch {
    saveStatus.textContent = "未能保存，请检查浏览器存储后重试。";
  }
});

definition.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-entry]");
  if (!link) return;
  event.preventDefault();
  const entry = link.getAttribute("data-entry");
  if (entry.startsWith("entry://")) void search(entry.slice(8).split("#")[0]);
});

root.querySelector("#lexicon-notebook").addEventListener("click", () => View.open("notebook"));
window.addEventListener("storage", (event) => {
  if (event.key === Notebook.NOTE_KEY || event.key === null) updateSave();
});

View.register("dictionary", () => {
  View.setHeading("词典", "用柯林斯释义与双语例句理解单词，把生词留下来。");
  View.show("dictionary");
  updateSave();
  input.focus();
});
