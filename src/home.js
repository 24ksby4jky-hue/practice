import * as HomeModel from "./home-model.js";
import * as NotebookModel from "./notebook-model.js";
import * as NotebookStore from "./notebook-store.js";
import * as Daily from "./notebook-daily-model.js";
import * as DictationModel from "./dictation/dictation-model.js";
import { startNotebookDictation, startDailyDictation } from "./dictation/dictation.js";
import * as View from "./view.js";
import DictationWords from "./dictation/words/index.js";
import { showReading } from "./reading/reading.js";
import { annotationState, loadAnnotation } from "./dictionary-annotations.js";
import { renderDictionaryEntries } from "./reading/dictionary.js";

const el = (id) => document.getElementById(id);

const HOME_NOTE = "选一块开始。练习记录只留在这台设备上。";
const BASIC_NOTE = "练输入，练拼写，再把一个句子写完整。";

// 生词本的查看状态（筛选 / 搜索 / 排序 / 日期）。只活在内存里：这是「我这次想看什么」，
// 不是数据。下次进来从「全部、按时间、不限日期」重新开始，比记住上次筛到哪一档更好猜。
let noteFilter = "all";
let noteQuery = "";
let noteSort = "time";
let noteDay = "";
const noteExpanded = new Set();
let noteDetailsId = 0;
let noteRefreshPending = false;

// 一次渲染多少行。生词本不再有上限，几千行一次铺出来会卡；
// 但分页会让人以为词丢了，所以用「显示更多」把剩下的接着加上。
const NOTE_PAGE = 50;
// 首屏最多预取多少个词的柯林斯注释 —— 整本预取等于给每个词发一次请求。
const ANNOTATION_PREFETCH = 40;
let noteRenderLimit = NOTE_PAGE;
let pendingImport = null;
let importStatus = "";

// 4000 词的词表扫一遍就够了，不要每次重绘都重建。
const WORD_INDEX = NotebookModel.wordIndex(DictationWords);
const SOURCE_INDEX = NotebookModel.sourceIndex(DictationWords);

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
  return NotebookStore.load().notes;
}

// 补音标、词性、例句、来源，再挂上柯林斯注释和复习进度。
// 只给当前要渲染的那几十行调用 —— 整本补一遍在几千词时会明显卡顿。
function enrichNote(note) {
  const found = WORD_INDEX[note.word] || null;
  const base = NotebookModel.enrich([note], () => found, SOURCE_INDEX)[0];
  const annotation = annotationState(note.word);
  return {
    ...base,
    review: NotebookModel.reviewOf(note),
    annotation,
    meaning: annotation?.preview?.meaning || note.meaning
  };
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
      NotebookStore.setLevel(item.word, level.id);
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

  // 复习进度：这个词还要不要看、什么时候再看。没有这一行，
  // 「每日听写」对用户来说就是个黑盒 —— 不知道哪些词被安排了。
  const review = item.review || NotebookModel.reviewOf(item);
  const progress = document.createElement("span");
  progress.className = "note-review";
  progress.textContent = reviewText(item, review);
  body.append(progress);

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
    NotebookStore.remove(item.word);
    noteExpanded.delete(item.word);
    paintNotebook();
  });

  const actions = document.createElement("div"); actions.className = "note-word-actions";
  actions.append(expand, remove);
  row.append(head, levels, body, actions, full);
  return row;
}

// 复习进度的一句话。四档：已掌握 / 还没听过 / 今天到期 / 某天到期。
// 手动标了「记住了」的词不进每日计划，这里要说明白，否则用户会以为漏掉了。
function reviewText(item, review) {
  if (item.level === 2) return "已掌握 · 不再进入每日听写";
  const counters = review.lastAt ? ` · 对 ${review.correct} · 错 ${review.wrong}` : "";
  if (!review.lastAt) return `新词 · 等待首次听写${counters}`;
  const stage = `第 ${review.stage + 1} 阶`;
  if (review.dueDay === "" || review.dueDay <= NotebookModel.todayDay()) return `今天复习 · ${stage}${counters}`;
  const month = Number(review.dueDay.slice(5, 7));
  const day = Number(review.dueDay.slice(8, 10));
  return `${month}月${day}日复习 · ${stage}${counters}`;
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
  const dated = noteDay ? NotebookModel.notesOnDay(all, noteDay) : all;
  const needle = noteQuery.trim().toLowerCase();
  // 搜索也要命中柯林斯现查到的释义：存下来的可能只是当时的简写。
  // 只在真的在搜索时才拼这一层，平时不复制整张表。
  const searchable = needle
    ? dated.map((note) => ({
      ...note,
      meaning: `${note.meaning || ""} ${annotationState(note.word)?.preview?.meaning || ""}`
    }))
    : dated;
  return NotebookModel.sortNotes(
    NotebookModel.filterNotes(searchable, noteFilter, needle), noteSort);
}

function dayNotes(all) {
  if (!noteDay) return [];
  return NotebookModel.sortNotes(NotebookModel.notesOnDay(all, noteDay), "time");
}

function noteEmptyText(all) {
  if (noteQuery.trim()) return `没有匹配「${noteQuery.trim()}」的词。`;
  if (noteDay && NotebookModel.notesOnDay(all, noteDay).length === 0) return "这一天还没有生词。";
  return "这一档还没有词。";
}

function paintNotebook() {
  const box = el("notebook-view");
  box.textContent = "";

  const store = NotebookStore.load();
  const all = store.notes;
  const bookCounts = NotebookModel.countsByLevel(all);
  const counts = NotebookModel.countsByLevel(noteDay ? NotebookModel.notesOnDay(all, noteDay) : all);
  const list = visibleNotes(all);
  const streak = Daily.streakOf(store, NotebookModel.todayDay());

  const head = document.createElement("div");
  head.className = "page-head";
  const title = document.createElement("h2");
  title.textContent = "生词本";
  const count = document.createElement("p");
  count.className = "hint";
  // 「还要看多少」比「一共多少」有用 —— 记住了的不必再看
  count.textContent = all.length
    ? `共 ${all.length} 词 · 还要看 ${bookCounts[0] + bookCounts[1]} · 连续 ${streak.current} 天`
    : "";
  head.append(title, count);
  box.append(head);

  box.append(dailyCard(store));

  const warning = storageWarning();
  if (warning) box.append(warning);

  if (!all.length) {
    const empty = document.createElement("p");
    empty.className = "note-empty";
    empty.textContent = "还没有生词。可在听写中记入生词，或在词典、阅读查词后点击“加入生词本”。";
    box.append(empty);
    box.append(backupBar());
    return;
  }

  box.append(noteToolbar(counts, all));
  box.append(noteListBlock(list, all));

  const history = historyBlock(store);
  if (history) box.append(history);

  const actions = document.createElement("div");
  actions.className = "note-actions";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "清空生词本";
  let armed = false;
  clear.addEventListener("click", () => {
    // 清空是唯一不可撤销的动作，所以要问第二次。听写记录也会一起清掉，
    // 按钮上要说明白 —— 连续天数消失是预期内的。
    if (!armed) {
      armed = true;
      clear.textContent = "再点一次确认清空（含听写记录）";
      return;
    }
    NotebookStore.clear();
    noteExpanded.clear();
    noteRenderLimit = NOTE_PAGE;
    paintNotebook();
  });
  actions.append(clear);
  box.append(actions);
  box.append(backupBar());
}

function noteListBlock(list, all) {
  const wrap = document.createElement("div");
  wrap.className = "note-list-wrap";
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "note-empty";
    empty.textContent = noteEmptyText(Array.isArray(all) ? all : []);
    wrap.append(empty);
    return wrap;
  }
  wrap.append(noteRows(list.slice(0, noteRenderLimit).map(enrichNote)));
  if (list.length > noteRenderLimit) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "note-more";
    more.textContent = `显示更多（还有 ${list.length - noteRenderLimit} 词）`;
    more.addEventListener("click", () => {
      noteRenderLimit += NOTE_PAGE;
      paintNotebook();
    });
    wrap.append(more);
  }
  return wrap;
}

/* --------------------------------------------------------------------------
   每日生词听写
   -------------------------------------------------------------------------- */

function dailyCard(store) {
  const today = NotebookModel.todayDay();
  const status = Daily.dailyStatus(store, today);
  const streak = Daily.streakOf(store, today);

  const card = document.createElement("section");
  card.className = "daily-card";

  const head = document.createElement("div");
  head.className = "daily-head";
  const title = document.createElement("h3");
  title.textContent = "每日生词听写";
  const summary = document.createElement("p");
  summary.className = "hint";
  summary.textContent = dailySummary(status);
  head.append(title, summary);
  card.append(head);

  const actions = document.createElement("div");
  actions.className = "daily-actions";

  const start = document.createElement("button");
  start.type = "button";
  start.className = "daily-start";
  start.textContent = status.state === "done" ? "今日已完成"
    : status.state === "in-progress" ? `继续听写（${status.graded} / ${status.total}）`
      : "开始今日听写";
  start.disabled = !status.canStart;
  start.addEventListener("click", startDaily);
  actions.append(start);

  // 每日词量只影响下一次建计划；今天已经开始的这一轮不换词。
  const countLabel = document.createElement("label");
  countLabel.className = "daily-count";
  countLabel.append(document.createTextNode("每日"));
  const count = document.createElement("input");
  count.type = "number";
  count.min = String(NotebookModel.DAILY_COUNT_MIN);
  count.max = String(NotebookModel.DAILY_COUNT_MAX);
  count.step = "5";
  count.value = String(status.dailyCount);
  count.setAttribute("aria-label", "每日听写词量");
  count.addEventListener("change", () => {
    NotebookStore.setDailyCount(count.value);
    paintNotebook();
  });
  countLabel.append(count, document.createTextNode("词"));
  actions.append(countLabel);

  const streakLine = document.createElement("span");
  streakLine.className = "daily-streak";
  streakLine.textContent = streak.current
    ? `连续 ${streak.current} 天 · 最长 ${streak.longest} 天`
    : `最长 ${streak.longest} 天 · 累计 ${streak.totalDays} 天`;
  actions.append(streakLine);

  card.append(actions);
  card.append(calendarBlock(store, today));
  return card;
}

function dailySummary(status) {
  if (status.state === "done") {
    return `今日已完成 · 正确率 ${status.accuracy}%${status.remaining ? ` · 还剩 ${status.remaining} 词` : ""}`;
  }
  if (status.state === "in-progress") {
    return `已听 ${status.graded} / ${status.total} · 正确率 ${status.accuracy}%`;
  }
  if (status.state === "empty") return "今天没有到期或新增的词。去阅读或查词收几个新词吧。";
  return `新词 ${status.newCount} · 复习 ${status.dueCount} · 今日取 ${Math.min(status.total, status.dailyCount)} 词`;
}

// 建计划 → 从已判结果续听 → 每个词判完立刻入账。
// 所有写盘都走 NotebookStore，听写页本身不认识 localStorage。
function startDaily() {
  const now = Date.now();
  const today = NotebookModel.todayDay(now);
  const store = NotebookStore.load();
  const { store: next, plan } = Daily.ensurePlan(store, today, now);
  if (next !== store) NotebookStore.save(next);
  if (!plan || plan.finishedAt) {
    paintNotebook();
    return;
  }
  const resume = Daily.resumeState(plan);
  const words = Daily.dailySessionNotes(next, plan, (word) => WORD_INDEX[word] || null);
  const started = startDailyDictation({
    day: today,
    words,
    results: resume.results,
    elapsedSeconds: resume.elapsedSeconds,
    onGrade(word, correct) {
      NotebookStore.update((current) => Daily.applyGradeToStore(current, today, word, correct, Date.now()));
    },
    onProgress(seconds) {
      NotebookStore.update((current) => Daily.touchPlan(current, today, seconds));
    },
    onFinish({ elapsedSeconds }) {
      NotebookStore.update((current) => Daily.finishPlan(current, today, Date.now(), elapsedSeconds));
    }
  });
  if (!started) paintNotebook();
}

function calendarBlock(store, today) {
  const labels = {
    done: "已完成", partial: "做了一部分", missed: "有计划没做",
    started: "今天已开始", none: "没有计划"
  };
  const grid = document.createElement("div");
  grid.className = "daily-calendar";
  for (const item of Daily.calendarDays(store, today, 30)) {
    const cell = document.createElement("span");
    cell.className = `daily-day ${item.state}${item.today ? " today" : ""}`;
    const text = `${item.day.slice(5)} ${labels[item.state] || ""}`;
    cell.title = item.accuracy === null || item.accuracy === undefined
      ? text : `${text} · 正确率 ${item.accuracy}%`;
    cell.setAttribute("aria-label", cell.title);
    grid.append(cell);
  }
  return grid;
}

function historyBlock(store) {
  if (!Array.isArray(store.history) || !store.history.length) return null;
  const details = document.createElement("details");
  details.className = "note-history";
  const summary = document.createElement("summary");
  summary.textContent = `听写记录 · 最近 ${Math.min(store.history.length, 10)} 次`;
  details.append(summary);
  const wrap = document.createElement("div");
  wrap.className = "daily-history";
  for (const item of store.history.slice(0, 10)) {
    const row = document.createElement("p");
    row.className = "daily-history-row";
    row.textContent = `${item.day} · ${item.graded} 词 · 正确率 ${item.accuracy}% · ${durationText(item.elapsedSeconds)}`;
    wrap.append(row);
  }
  details.append(wrap);
  return details;
}

function durationText(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/* --------------------------------------------------------------------------
   备份
   -------------------------------------------------------------------------- */

function storageWarning() {
  const status = NotebookStore.status();
  let text = "";
  if (status.pending) {
    text = "浏览器没能写入本地存储，本次记录只在内存里，刷新会丢失。请先导出备份。";
  } else if (NotebookStore.sizeWarning()) {
    text = "生词本已经很大，建议导出备份；本地存储写满后新词会保存失败。";
  }
  if (!text) return null;
  const line = document.createElement("p");
  line.className = "storage-warning";
  line.textContent = text;
  return line;
}

function backupBar() {
  const bar = document.createElement("div");
  bar.className = "note-backup";

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "导出备份";
  exportButton.title = "把生词、复习进度与听写记录存成一个 JSON 文件";
  exportButton.addEventListener("click", exportBackup);

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.textContent = "导入备份";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "application/json,.json";
  file.hidden = true;
  importButton.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const picked = file.files && file.files[0];
    file.value = "";
    if (picked) void chooseBackup(picked);
  });

  bar.append(exportButton, importButton, file);

  if (pendingImport) {
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "primary";
    confirm.textContent = "确认合并";
    confirm.addEventListener("click", confirmImport);
    bar.append(confirm);
  }
  if (importStatus) {
    const status = document.createElement("span");
    status.className = "hint";
    status.textContent = importStatus;
    bar.append(status);
  }
  return bar;
}

function exportBackup() {
  const today = NotebookModel.todayDay();
  NotebookStore.download(NotebookStore.exportText(Date.now()), `dictation-notebook-${today}.json`);
}

async function chooseBackup(file) {
  let text = "";
  try {
    text = await file.text();
  } catch {
    importStatus = "备份文件无法读取。";
    paintNotebook();
    return;
  }
  const parsed = NotebookStore.parseImport(text);
  if (!parsed.ok) {
    pendingImport = null;
    importStatus = parsed.error || "备份文件无法识别";
    paintNotebook();
    return;
  }
  pendingImport = parsed.store;
  importStatus = `将合并 ${parsed.store.notes.length} 个词、${parsed.store.history.length} 天记录。`;
  paintNotebook();
}

function confirmImport() {
  const incoming = pendingImport;
  if (!incoming) return;
  const result = NotebookStore.merge(incoming);
  pendingImport = null;
  importStatus = result.ok
    ? `已导入，生词本现有 ${result.store.notes.length} 个词。`
    : "导入没能写入本地存储，请先导出备份再重试。";
  paintNotebook();
}

function noteRows(list) {
  const rows = document.createElement("div");
  rows.className = "note-list";
  list.forEach((item) => rows.append(noteRow(item)));
  return rows;
}

// 筛选 / 搜索 / 排序。这三样回答的都是「我该看哪些词」—— 词攒到几十个之后，
// 它们比列表本身更值钱。参照的是欧路词典生词本按星级和时间筛的做法。
function noteToolbar(counts, all) {
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
      noteRenderLimit = NOTE_PAGE;
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
    noteRenderLimit = NOTE_PAGE;
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
    noteRenderLimit = NOTE_PAGE;
    paintNotebook();
  });

  const day = document.createElement("div");
  day.className = "note-day";
  const date = document.createElement("input");
  date.type = "date";
  date.className = "note-date";
  date.value = noteDay;
  date.setAttribute("aria-label", "选择加入日期");
  date.addEventListener("change", () => {
    noteDay = date.value;
    noteRenderLimit = NOTE_PAGE;
    paintNotebook();
  });

  const sessionWords = DictationModel.notebookSessionWords(dayNotes(all));
  const dictate = document.createElement("button");
  dictate.type = "button";
  dictate.className = "note-dictate";
  dictate.textContent = "当日生词听写";
  dictate.disabled = sessionWords.length === 0;
  dictate.title = !noteDay
    ? "先选择日期"
    : sessionWords.length
      ? `听写这一天的 ${sessionWords.length} 个单词`
      : "这一天没有可以听写的单词";
  dictate.addEventListener("click", () => {
    const words = dayNotes(storedNotes());
    startNotebookDictation(words, DictationModel.notebookDayLabel(noteDay));
  });
  day.append(date, dictate);

  bar.append(filters, search, sort, day);
  return bar;
}

// 搜索时只换列表那一块 —— 输入框留在原地，焦点和光标都不会丢。
function repaintNoteList() {
  const old = el("notebook-view").querySelector(".note-list-wrap");
  if (!old) return;
  const all = NotebookStore.load().notes;
  old.replaceWith(noteListBlock(visibleNotes(all), all));
}

function showNotebook() {
  paintNotebook();
  View.setHeading("生词本", "收集听写、阅读与词典中的生词，按每日计划复习。");
  View.show("notebook");
  // 只预取首屏要显示的那几十个词，整本预取在几千词时等于发几千次请求。
  for (const note of visibleNotes(storedNotes()).slice(0, ANNOTATION_PREFETCH)) {
    const state = annotationState(note.word);
    if (state?.status === "ready" || state?.status === "error") continue;
    void loadAnnotation(note.word).then(refreshNotebookAnnotations);
  }
}

// 另一个标签页改了生词本时跟着刷新。正在输入搜索词就不动，
// 否则列表一换，光标和输入框里的内容都会丢。
window.addEventListener("storage", (event) => {
  if (event.key !== NotebookStore.KEY && event.key !== null) return;
  if (document.body.dataset.view !== "notebook") return;
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
  paintNotebook();
});

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
