import * as HomeModel from "./home-model.js";
import * as NotebookModel from "./notebook-model.js";
import * as View from "./view.js";
import { persistJson } from "./typing/app.js";
import DictationWords from "./dictation/words/index.js";
import { showReading } from "./reading/reading.js";
import { annotationState, loadAnnotation } from "./notebook-dictionary.js";
import { renderDictionaryEntries } from "./reading/dictionary.js";

const el = (id) => document.getElementById(id);

const HOME_NOTE = "选一块开始。练习记录只留在这台设备上。";
const BASIC_NOTE = "练输入，练拼写，再把一个句子写完整。";

// 生词本的查看状态（筛选 / 搜索 / 排序）。只活在内存里：这是「我这次想看什么」，
// 不是数据。下次进来从「全部、按时间」重新开始，比记住上次筛到哪一档更好猜。
let noteFilter = "all";
let noteQuery = "";
let noteSort = "time";
const noteExpanded = new Set();
let noteDetailsId = 0;
let noteRefreshPending = false;

/* --------------------------------------------------------------------------
   模块格 —— 一格一个模块，印线共用
   -------------------------------------------------------------------------- */

function moduleCell(module) {
  const soon = !HomeModel.isReady(module.id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = soon ? "module-cell soon" : "module-cell";

  const title = document.createElement("strong");
  title.textContent = module.name;
  const note = document.createElement("span");
  note.className = "hint";
  note.textContent = module.note;

  const mark = document.createElement("span");
  mark.className = soon ? "cell-soon" : "cell-go";
  mark.textContent = soon ? "建设中" : "进入 ›";

  button.append(title, note, mark);
  button.addEventListener("click", () => openModule(module.id));
  return button;
}

// 方格本里空着的一格。格子总数取偶数个，3 / 2 / 1 列都整行填满，
// 外框不用补规则也不会开缝。
function blankCell() {
  const blank = document.createElement("div");
  blank.className = "module-cell blank";
  blank.setAttribute("aria-hidden", "true");
  return blank;
}

function fillGrid(container, cells) {
  const grid = document.createElement("div");
  grid.className = "module-grid";
  cells.forEach((cell) => grid.append(cell));
  // 补到 6 格（3 列的整数倍，也是 2 列和 1 列的整数倍）
  while (grid.children.length % 6 !== 0) grid.append(blankCell());
  container.append(grid);
}

function practiceCell(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "module-cell";
  const title = document.createElement("strong");
  title.textContent = item.name;
  const note = document.createElement("span");
  note.className = "hint";
  note.textContent = item.note;
  const mark = document.createElement("span");
  mark.className = "cell-go";
  mark.textContent = "进入 ›";
  button.append(title, note, mark);
  button.addEventListener("click", () => View.open(item.id));
  return button;
}

/* --------------------------------------------------------------------------
   四个页面
   -------------------------------------------------------------------------- */

function showHome() {
  View.setHeading("首页", HOME_NOTE);
  View.show("home");
}

function showBasic() {
  View.setHeading("基础练习", BASIC_NOTE);
  View.show("basic");
}

function openModule(id) {
  const view = HomeModel.viewFor(id);
  if (view === "soon") {
    showSoon(id);
    return;
  }
  View.open(view);
}

function showSoon(moduleId) {
  const module = HomeModel.moduleById(moduleId);
  if (!module) {
    showHome();
    return;
  }
  const box = el("soon-view");
  box.textContent = "";
  const sheet = document.createElement("section");
  sheet.className = "wip-sheet";
  const title = document.createElement("h2");
  title.textContent = `${module.name}·建设中`;
  const line = document.createElement("p");
  line.textContent = module.note;
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "这一块还没开始做。现在能用的是基础练习和生词本。";
  sheet.append(title, line, note);
  box.append(sheet);
  View.setHeading(module.name, "建设中");
  View.show("soon", moduleId);
}

/* --------------------------------------------------------------------------
   生词本
   -------------------------------------------------------------------------- */

function storedNotes() {
  return NotebookModel.readNotes(localStorage.getItem(NotebookModel.NOTE_KEY));
}

function saveNotes(list) {
  persistJson(NotebookModel.NOTE_KEY, list);
}

function noteRow(item) {
  const row = document.createElement("div");
  row.className = "note-row";
  // 记住了的整行压暗 —— 一眼看得出哪些还要看。红只用来批改，这里不用红。
  if (item.level === 2) row.classList.add("note-known");

  const head = document.createElement("span");
  head.className = "note-word-cell";
  const word = document.createElement("span");
  word.className = "note-word";
  word.textContent = item.word;
  head.append(word);
  if (item.phonetic) {
    const phonetic = document.createElement("span");
    phonetic.className = "note-phonetic";
    phonetic.textContent = item.phonetic;
    head.append(phonetic);
  }

  // 掌握程度三档，选中的用墨填 —— 和阅读模块的排版选项同一套写法。
  // 这一档是参照欧路词典生词本的星级来的：光有词没有状态，攒到上限就只会越看越乱。
  const levels = document.createElement("span");
  levels.className = "note-levels";
  for (const level of NotebookModel.LEVELS) {
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "note-level";
    pick.textContent = level.name;
    pick.setAttribute("aria-pressed", String(item.level === level.id));
    if (item.level === level.id) pick.classList.add("active");
    pick.addEventListener("click", () => {
      saveNotes(NotebookModel.setLevel(storedNotes(), item.word, level.id));
      // 整页重画：左边那排筛选按钮上的计数也要跟着变
      paintNotebook();
    });
    levels.append(pick);
  }

  const body = document.createElement("div");
  body.className = "note-body";
  const annotation = item.annotation;
  const hasCollins = Boolean(annotation?.preview);
  const label = document.createElement("span");
  label.className = "note-dictionary-label";
  label.textContent = hasCollins ? "柯林斯双解"
    : annotation?.status === "error" ? "柯林斯暂时无法加载 · 原收藏释义"
    : annotation?.status === "ready" ? "柯林斯未收录 · 原收藏释义" : "正在读取柯林斯释义…";
  if (hasCollins && annotation.result.matched !== item.word.toLowerCase()) label.textContent += ` · ${item.word} → ${annotation.result.matched}`;
  body.append(label);
  const meaning = document.createElement("span");
  meaning.className = "note-meaning";
  meaning.textContent = hasCollins || annotation?.status === "error" || annotation?.status === "ready" ? item.meaning || "暂无保存的释义" : "";
  body.append(meaning);
  if (annotation?.preview?.example) {
    const example = document.createElement("span");
    example.className = "note-example";
    example.textContent = annotation.preview.example;
    body.append(example);
  }
  if (item.source) {
    const source = document.createElement("span");
    source.className = "note-source";
    source.textContent = item.source.type === "reading" ? `阅读 · ${item.source.title}`
      : `${item.source.boardName} · 第 ${item.source.unit} 单元`;
    if (item.source.type === "reading" && item.source.query && item.source.query !== item.word) source.textContent += ` · 原文：${item.source.query}`;
    body.append(source);
  }

  if (annotation?.status === "error") {
    const retry = document.createElement("button"); retry.type = "button";
    retry.className = "note-retry"; retry.textContent = "重新加载柯林斯";
    retry.addEventListener("click", () => {
      void loadAnnotation(item.word, { retry: true }).then(refreshNotebookAnnotations);
      repaintNoteList();
    });
    body.append(retry);
  }

  const full = document.createElement("section");
  full.className = "note-full-definition dictionary-definition";
  full.id = `note-full-${++noteDetailsId}`;
  full.hidden = !noteExpanded.has(item.word);
  const expand = document.createElement("button"); expand.type = "button";
  expand.className = "note-expand";
  expand.setAttribute("aria-controls", full.id);
  expand.setAttribute("aria-expanded", String(!full.hidden));
  expand.textContent = full.hidden ? "查看全部注释" : "收起全部注释";
  expand.disabled = annotation?.status === "ready" && !hasCollins || annotation?.status === "error";
  function paintFull() {
    if (full.hidden) return;
    if (hasCollins) renderDictionaryEntries(full, annotation.result, { links: false });
    else full.textContent = annotation?.status === "error" ? "柯林斯暂时无法加载，请重试。"
      : annotation?.status === "ready" ? "柯林斯未收录这个词。" : "正在读取全部注释…";
  }
  expand.addEventListener("click", () => {
    full.hidden = !full.hidden;
    if (full.hidden) noteExpanded.delete(item.word); else noteExpanded.add(item.word);
    expand.setAttribute("aria-expanded", String(!full.hidden));
    expand.textContent = full.hidden ? "查看全部注释" : "收起全部注释";
    paintFull();
  });
  paintFull();

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "note-remove";
  remove.textContent = "删除";
  remove.addEventListener("click", () => {
    saveNotes(NotebookModel.removeNote(storedNotes(), item.word));
    noteExpanded.delete(item.word);
    paintNotebook();
  });

  const actions = document.createElement("div"); actions.className = "note-word-actions";
  actions.append(expand, remove);
  row.append(head, levels, body, actions, full);
  return row;
}

// 补齐音标、词性、例句和来源。三处都要这份数据，所以只写一遍。
function notebookData() {
  const index = NotebookModel.wordIndex(DictationWords);
  return NotebookModel.enrich(storedNotes(), (word) => index[word] || null,
    NotebookModel.sourceIndex(DictationWords)).map((note) => {
      const annotation = annotationState(note.word);
      return { ...note, annotation, meaning: annotation?.preview?.meaning || note.meaning };
    });
}

function refreshNotebookAnnotations() {
  if (document.body.dataset.view !== "notebook" || noteRefreshPending) return;
  noteRefreshPending = true;
  requestAnimationFrame(() => {
    noteRefreshPending = false;
    if (document.body.dataset.view === "notebook") repaintNoteList();
  });
}

function visibleNotes(all) {
  return NotebookModel.sortNotes(
    NotebookModel.filterNotes(all, noteFilter, noteQuery), noteSort);
}

function noteEmptyText() {
  return noteQuery.trim() ? `没有匹配「${noteQuery.trim()}」的词。` : "这一档还没有词。";
}

function paintNotebook() {
  const box = el("notebook-view");
  box.textContent = "";

  const all = notebookData();
  const counts = NotebookModel.countsByLevel(all);
  const list = visibleNotes(all);

  const head = document.createElement("div");
  head.className = "page-head";
  const title = document.createElement("h2");
  title.textContent = "生词本";
  const count = document.createElement("p");
  count.className = "hint";
  // 「还要看多少」比「一共多少」有用 —— 记住了的不必再看
  count.textContent = all.length
    ? `共 ${all.length} 词 · 还要看 ${counts[0] + counts[1]} · 上限 ${NotebookModel.NOTE_LIMIT}`
    : "";
  head.append(title, count);
  box.append(head);

  if (!all.length) {
    const empty = document.createElement("p");
    empty.className = "note-empty";
    empty.textContent = "还没有生词。可在听写中记入生词，或在阅读查词后点击“加入生词本”。";
    box.append(empty);
    return;
  }

  box.append(noteToolbar(counts));

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "note-empty";
    empty.textContent = noteEmptyText();
    box.append(empty);
  } else {
    box.append(noteRows(list));
  }

  const actions = document.createElement("div");
  actions.className = "note-actions";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "清空生词本";
  let armed = false;
  clear.addEventListener("click", () => {
    // 清空是唯一不可撤销的动作，所以要问第二次
    if (!armed) {
      armed = true;
      clear.textContent = "再点一次确认清空";
      return;
    }
    saveNotes(NotebookModel.clearNotes());
    noteExpanded.clear();
    paintNotebook();
  });
  actions.append(clear);
  box.append(actions);
}

function noteRows(list) {
  const rows = document.createElement("div");
  rows.className = "note-list";
  list.forEach((item) => rows.append(noteRow(item)));
  return rows;
}

// 筛选 / 搜索 / 排序。这三样回答的都是「我该看哪些词」—— 词攒到几十个之后，
// 它们比列表本身更值钱。参照的是欧路词典生词本按星级和时间筛的做法。
function noteToolbar(counts) {
  const bar = document.createElement("div");
  bar.className = "note-toolbar";

  const filters = document.createElement("div");
  filters.className = "note-filters";
  const tabs = [["all", `全部 ${counts.all}`]]
    .concat(NotebookModel.LEVELS.map((level) => [level.id, `${level.name} ${counts[level.id]}`]));
  for (const [value, label] of tabs) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "note-filter";
    tab.textContent = label;
    tab.setAttribute("aria-pressed", String(noteFilter === value));
    if (noteFilter === value) tab.classList.add("active");
    tab.addEventListener("click", () => {
      noteFilter = value;
      paintNotebook();
    });
    filters.append(tab);
  }

  const search = document.createElement("input");
  search.type = "search";
  search.className = "note-search";
  search.placeholder = "找词或释义";
  search.value = noteQuery;
  search.setAttribute("aria-label", "在生词本里搜索");
  search.addEventListener("input", () => {
    noteQuery = search.value;
    // 只换列表那一块。整页重画会让输入框每敲一个字就掉一次焦点。
    repaintNoteList();
  });

  const sort = document.createElement("button");
  sort.type = "button";
  sort.className = "note-sort";
  sort.textContent = noteSort === "level" ? "按掌握程度" : "按加入时间";
  sort.title = "切换排序";
  sort.addEventListener("click", () => {
    noteSort = noteSort === "level" ? "time" : "level";
    paintNotebook();
  });

  bar.append(filters, search, sort);
  return bar;
}

// 搜索时只换列表那一块 —— 输入框留在原地，焦点和光标都不会丢。
function repaintNoteList() {
  const old = el("notebook-view").querySelector(".note-list, .note-empty");
  if (!old) return;
  const list = visibleNotes(notebookData());
  if (list.length) {
    old.replaceWith(noteRows(list));
    return;
  }
  const empty = document.createElement("p");
  empty.className = "note-empty";
  empty.textContent = noteEmptyText();
  old.replaceWith(empty);
}

function showNotebook() {
  paintNotebook();
  View.setHeading("生词本", "收集听写与阅读中的生词，用柯林斯释义和例句复习。");
  View.show("notebook");
  for (const note of storedNotes()) {
    if (annotationState(note.word)?.status === "ready" || annotationState(note.word)?.status === "error") continue;
    void loadAnnotation(note.word).then(refreshNotebookAnnotations);
  }
}

/* --------------------------------------------------------------------------
   接线
   -------------------------------------------------------------------------- */

View.register("home", showHome);
View.register("basic", showBasic);
View.register("notebook", showNotebook);
View.register("reading", showReading);
View.register("soon", showSoon);

fillGrid(el("home-view"), HomeModel.MODULES.map(moduleCell));
fillGrid(el("basic-view"), HomeModel.PRACTICE.map(practiceCell));

View.open("home");
