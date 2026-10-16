import * as HomeModel from "./home-model.js";
import * as NotebookModel from "./notebook-model.js";
import * as View from "./view.js";
import { persistJson } from "./typing/app.js";
import DictationWords from "./dictation/words/index.js";

const el = (id) => document.getElementById(id);

const HOME_NOTE = "选一块开始。练习记录只留在这台设备上。";
const BASIC_NOTE = "打字和听写都是逐字练，先把这一块练熟。";

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

  const head = document.createElement("span");
  head.className = "note-word-cell";
  const word = document.createElement("span");
  word.className = "note-word";
  word.textContent = item.word;
  head.append(word);
  if (item.missing) {
    // 词表改过之后这个老词可能已经不在了。标一下，但用户记的东西不删。
    const gone = document.createElement("span");
    gone.className = "note-gone";
    gone.textContent = "词表外";
    head.append(gone);
  } else if (item.phonetic) {
    const phonetic = document.createElement("span");
    phonetic.className = "note-phonetic";
    phonetic.textContent = item.phonetic;
    head.append(phonetic);
  }

  const body = document.createElement("span");
  const meaning = document.createElement("span");
  meaning.className = "note-meaning";
  if (!item.missing && item.pos) {
    const pos = document.createElement("span");
    pos.className = "note-pos";
    pos.textContent = item.pos;
    meaning.append(pos);
  }
  meaning.append(document.createTextNode(item.meaning));
  body.append(meaning);
  if (item.example) {
    const example = document.createElement("span");
    example.className = "note-example";
    example.textContent = item.example;
    body.append(example);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "删除";
  remove.addEventListener("click", () => {
    saveNotes(NotebookModel.removeNote(storedNotes(), item.word));
    paintNotebook();
  });

  row.append(head, body, remove);
  return row;
}

function paintNotebook() {
  const box = el("notebook-view");
  box.textContent = "";

  const index = NotebookModel.wordIndex(DictationWords);
  const list = NotebookModel.enrich(storedNotes(), (word) => index[word] || null);

  const head = document.createElement("div");
  head.className = "page-head";
  const title = document.createElement("h2");
  title.textContent = "生词本";
  const count = document.createElement("p");
  count.className = "hint";
  count.textContent = list.length ? `共 ${list.length} 词 · 上限 ${NotebookModel.NOTE_LIMIT}` : "";
  head.append(title, count);
  box.append(head);

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "note-empty";
    empty.textContent = "还没有生词。听写时拼错的词会自动记在这里。";
    box.append(empty);
    return;
  }

  const rows = document.createElement("div");
  rows.className = "note-list";
  list.forEach((item) => rows.append(noteRow(item)));
  box.append(rows);

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
    paintNotebook();
  });
  actions.append(clear);
  box.append(actions);
}

function showNotebook() {
  paintNotebook();
  View.setHeading("生词本", "听写里拼错的词，或你按「记入生词本」留下的词。");
  View.show("notebook");
}

/* --------------------------------------------------------------------------
   接线
   -------------------------------------------------------------------------- */

View.register("home", showHome);
View.register("basic", showBasic);
View.register("notebook", showNotebook);
View.register("soon", showSoon);

fillGrid(el("home-view"), HomeModel.MODULES.map(moduleCell));
fillGrid(el("basic-view"), HomeModel.PRACTICE.map(practiceCell));

View.open("home");
