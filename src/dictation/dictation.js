import * as DictationModel from "./dictation-model.js";
import * as NotebookStore from "../notebook-store.js";
import * as View from "../view.js";
import { persistJson, measureLine } from "../typing/app.js";
import { annotationState } from "../dictionary-annotations.js";
import { mountDictationAnnotation } from "./dictation-annotation.js";
// 板块顺序由 words/index.js 决定 —— 听写和生词本共用同一份，不再靠
// index.html 里 <script> 标签的加载顺序，也不再挂在 globalThis 上。
import DictationWords from "./words/index.js";

const dict = {
  boardId: "campus",
  unitNumber: 1,
  kind: "unit",
  screen: "picker",
  words: [],
  index: 0,
  input: "",
  complete: false,
  correct: false,
  revealed: false,
  skipped: false,
  review: false,
  sessionDone: false,
  results: [],
  spendSecond: 0,
  timer: 0,
  accent: "uk",
  started: false,
  playing: false,
  origin: "",
  notebookWords: null,
  sessionSource: "",
  daily: null,
  dailyFinished: false,
  hooks: null
};

const root = document.getElementById("dictation-view");
let answerAnnotation = null;

function boardById(id) {
  return DictationWords.find((item) => item.id === id) || DictationWords[0];
}

function rawDone() {
  try {
    return JSON.parse(localStorage.getItem(DictationModel.unitDoneKey()) || "null");
  } catch {
    return null;
  }
}

function clearAttempt() {
  dict.complete = false;
  dict.correct = false;
  dict.revealed = false;
  dict.skipped = false;
  dict.input = "";
  dict.results = [];
}

function showPicker() {
  answerAnnotation?.close(); answerAnnotation = null;
  dict.screen = "picker";
  dict.words = [];
  dict.index = 0;
  dict.started = false;
  dict.sessionDone = false;
  dict.origin = "";
  dict.notebookWords = null;
  dict.sessionSource = "";
  dict.daily = null;
  dict.dailyFinished = false;
  dict.hooks = null;
  clearAttempt();
  document.getElementById("dict-picker").hidden = false;
  document.getElementById("dict-card").hidden = true;
  document.getElementById("dict-report").hidden = true;
  document.getElementById("dict-stats").hidden = true;
  document.getElementById("dict-progress").hidden = true;
  paintPicker();
}

function backToUnits() {
  stopTimer();
  stopSpeak();
  flushDailyProgress();
  const notebook = dict.origin === "notebook" || dict.origin === "daily";
  const screen = DictationModel.returnToUnits(dict.boardId);
  dict.boardId = screen.boardId;
  showPicker();
  if (notebook) View.open("notebook");
}

// 每日听写的用时和进度先落一次盘 —— 切标签页、关浏览器时
// 不会把这一轮刚开始的时间白白丢掉。
function flushDailyProgress() {
  if (dict.kind !== "daily" || dict.sessionDone) return;
  if (!dict.hooks || typeof dict.hooks.onProgress !== "function") return;
  try {
    dict.hooks.onProgress(dict.spendSecond);
  } catch (error) {
    console.warn("每日听写进度没能保存", error);
  }
}

// 判完一个词立刻告诉每日计划。回调在 home.js 里，这里只管广播。
function recordDailyGrade(word, correct) {
  if (dict.kind !== "daily" || !dict.hooks || typeof dict.hooks.onGrade !== "function") return;
  try {
    dict.hooks.onGrade(word, correct, dict.spendSecond);
  } catch (error) {
    console.warn("每日听写记录没能保存", error);
  }
}

function noteList() {
  return NotebookStore.load().notes;
}

function saveNote(word) {
  const meaning = annotationState(word.word)?.preview?.meaning || word.meaning;
  NotebookStore.addNote({ ...word, meaning }, Date.now());
}

function lettersOf(word) {
  return [...word].filter((char) => char !== " ").length;
}

function current() {
  return dict.words[dict.index] || null;
}

function elapsedMs() {
  return dict.spendSecond * 1000;
}

function accuracyOf(results) {
  if (!results.length) return 0;
  return Math.round(results.filter((item) => item.isCorrect).length / results.length * 100);
}

function wpmOf(results) {
  if (elapsedMs() <= 0) return 0;
  return Math.round(results.length / (elapsedMs() / 60000));
}

function stars(accuracy) {
  const count = accuracy >= 95 ? 5 : accuracy >= 85 ? 4 : accuracy >= 70 ? 3 : accuracy >= 50 ? 2 : 1;
  return "★".repeat(count) + "☆".repeat(5 - count);
}

function statusOf() {
  if (dict.skipped) return "unfinished";
  if (dict.results.some((item) => !item.isCorrect)) return "review";
  return "perfect";
}

function messageFor(status, errorCount, total) {
  if (status === "unfinished") return "别停，继续练习？";
  if (status === "perfect") return "非常棒，再来一次！";
  if (errorCount < total / 2) return "挺不错的嘛，继续练习？";
  return "不要灰心，别停，继续练习？";
}

function speak(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = dict.accent === "uk" ? "en-GB" : "en-US";
  utter.rate = 0.92;
  dict.playing = true;
  utter.onend = () => { dict.playing = false; paintPlay(); };
  utter.onerror = () => { dict.playing = false; paintPlay(); };
  window.speechSynthesis.speak(utter);
  paintPlay();
}

function stopSpeak() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  dict.playing = false;
  paintPlay();
}

function paintPlay() {
  const button = document.getElementById("dict-play");
  if (button) button.textContent = dict.playing ? "停止" : "播放单词发音";
}

function buildChars() {
  const word = current();
  if (!word) return [];
  const chars = [];
  let typedIndex = 0;
  for (const target of word.word) {
    if (target === " ") {
      chars.push({ target, input: " ", status: "correct", space: true });
      continue;
    }
    if (dict.revealed) {
      chars.push({ target, input: target, status: "error" });
    } else if (typedIndex < dict.input.length) {
      const typed = dict.input[typedIndex];
      chars.push({
        target,
        input: typed,
        status: typed.toLowerCase() === target.toLowerCase() ? "correct" : "error"
      });
    } else if (!dict.complete && typedIndex === dict.input.length) {
      chars.push({ target, status: "current" });
    } else {
      chars.push({ target, status: "pending" });
    }
    typedIndex += 1;
  }
  return chars;
}

function paintSlots() {
  const box = document.getElementById("dict-slots");
  box.replaceChildren();
  buildChars().forEach((item) => {
    const slot = document.createElement("span");
    slot.className = `slot ${item.status}${item.space ? " space" : ""}`;
    if (!item.space && item.status !== "pending" && item.status !== "current") {
      slot.textContent = item.input || item.target;
    }
    box.appendChild(slot);
  });
}

function paintStats() {
  const done = dict.results.length;
  const correct = dict.results.filter((item) => item.isCorrect).length;
  const accuracy = accuracyOf(dict.results);
  const minute = String(Math.floor(dict.spendSecond / 60)).padStart(2, "0");
  const second = String(dict.spendSecond % 60).padStart(2, "0");
  document.getElementById("dict-stats").innerHTML = `
    <div class="metric"><b>${done ? accuracy + "%" : "0%"}</b><span>正确率</span></div>
    <div class="metric"><b>${minute}:${second}</b><span>用时</span></div>
    <div class="metric"><b>${wpmOf(dict.results)}</b><span>单词数/min</span></div>
    <div class="metric"><b>${correct}/${dict.words.length || 0}</b><span>正确数</span></div>
  `;
  document.getElementById("dict-progress").textContent = dict.words.length
    ? DictationModel.progressLabel({
      review: dict.review,
      index: dict.index,
      total: dict.words.length,
      boardName: boardById(dict.boardId).name,
      unitNumber: dict.unitNumber,
      source: dict.origin === "notebook" || dict.origin === "daily" ? dict.sessionSource : ""
    })
    : "0 / 0";
}

function paintAnswer() {
  answerAnnotation?.close(); answerAnnotation = null;
  const panel = document.getElementById("dict-answer");
  const word = current();
  panel.hidden = !(dict.complete && word && !dict.sessionDone);
  if (panel.hidden) { panel.replaceChildren(); return; }
  panel.innerHTML = `
    <p class="${dict.correct ? "ok-label" : "bad-label"}">${dict.correct ? "正确" : "错误"}</p>
    <h2>${word.word}</h2>
    <p class="phonetic">${word.phonetic}</p>
    <div id="dict-annotation"></div>
    <div class="dialog-actions">
      <button type="button" id="dict-example">播放例句</button>
      ${dict.correct ? "" : '<button type="button" id="dict-note">记入生词本</button>'}
      <button type="button" id="dict-next" class="primary">下一词</button>
    </div>
  `;
  const exampleButton = document.getElementById("dict-example");
  answerAnnotation = mountDictationAnnotation(document.getElementById("dict-annotation"), word, (text) => {
    exampleButton.disabled = !text;
  });
  exampleButton.addEventListener("click", () => speak(answerAnnotation?.example()));
  const note = document.getElementById("dict-note");
  if (note) note.addEventListener("click", () => { saveNote(word); goNext(); });
  document.getElementById("dict-next").addEventListener("click", goNext);
  document.getElementById("dict-reveal").hidden = true;
}

function paintReport() {
  const report = document.getElementById("dict-report");
  report.hidden = !dict.sessionDone;
  document.getElementById("dict-card").hidden = dict.sessionDone;
  if (!dict.sessionDone) return;
  const status = statusOf();
  const accuracy = accuracyOf(dict.results);
  const errors = dict.results.filter((item) => !item.isCorrect);
  const notebookRound = dict.origin === "notebook" && !dict.review;
  const dailyRound = dict.origin === "daily" && !dict.review;
  const title = status === "unfinished"
    ? (dailyRound ? "每日听写未完成" : notebookRound ? "听写未完成" : dict.review ? "复习未完成" : "练习未完成")
    : (dailyRound ? "每日听写完成" : notebookRound ? "听写完成" : dict.review ? "复习完成" : "练习完成");
  const minute = String(Math.floor(dict.spendSecond / 60)).padStart(2, "0");
  const second = String(dict.spendSecond % 60).padStart(2, "0");
  report.innerHTML = `
    <h2>${title}</h2>
    <p class="pill">${messageFor(status, errors.length, dict.results.length)}</p>
    <div class="metrics">
      <div class="metric"><b>${accuracy}%</b><span>正确率</span></div>
      <div class="metric"><b>${minute}:${second}</b><span>用时</span></div>
      <div class="metric"><b>${wpmOf(dict.results)}</b><span>单词数/min</span></div>
      <div class="metric"><b>${stars(accuracy)}</b><span>评价</span></div>
    </div>
    <p>正确 ${dict.results.length - errors.length} · 错误 ${errors.length} · 总计 ${dict.results.length}</p>
    ${errors.length ? `<p>错词：${errors.map((item) => item.word).join("、")}</p>` : "<p>全部正确</p>"}
    <div class="dialog-actions">
      ${status === "review" ? '<button type="button" id="dict-review" class="primary">复习错词</button>' : ""}
      ${dailyRound ? "" : `<button type="button" id="dict-again" class="${status === "review" ? "" : "primary"}">再练一次</button>`}
      <button type="button" id="dict-back-report">${dict.origin === "notebook" || dict.origin === "daily" ? "返回生词本" : "返回单元"}</button>
    </div>
  `;
  const review = document.getElementById("dict-review");
  if (review) {
    review.addEventListener("click", () => {
      const missed = errors.map((item) => item.word);
      if (dict.origin === "notebook") {
        const list = (dict.notebookWords || []).filter((item) => missed.includes(item.word));
        begin(list, true, "notebook");
        return;
      }
      // 每日听写的错词重练也在当天计划里挑，但不带回调 ——
      // 同一个词同一天被推进两次档位，复习计划就失真了。
      if (dict.origin === "daily") {
        const list = (dict.words || []).filter((item) => missed.includes(item.word));
        begin(list, true, "daily");
        return;
      }
      startReview(missed);
    });
  }
  const again = document.getElementById("dict-again");
  if (again) {
    again.addEventListener("click", () => {
      if (dict.origin === "notebook") {
        begin((dict.notebookWords || []).map((item) => ({ ...item })), false, "notebook");
        return;
      }
      openUnit(dict.unitNumber);
    });
  }
  document.getElementById("dict-back-report").addEventListener("click", backToUnits);
}

function paintNotes() {
  const box = document.getElementById("dict-notes");
  const list = noteList();
  box.replaceChildren();
  if (!list.length) return;
  const heading = document.createElement("h3"); heading.textContent = "生词本";
  const articles = document.createElement("div"); articles.className = "articles";
  // 生词本不再有 40 条上限了，这里再整本铺出来会卡住每一词的判题重绘。
  const shown = list.slice(0, 12);
  for (const item of shown) {
    const article = document.createElement("span"); article.className = "article";
    const word = document.createElement("strong"); word.textContent = item.word;
    const meaning = document.createElement("em");
    meaning.textContent = annotationState(item.word)?.preview?.meaning || item.meaning;
    article.append(word, meaning); articles.append(article);
  }
  box.append(heading, articles);
  if (list.length > shown.length) {
    const more = document.createElement("p");
    more.className = "hint";
    more.textContent = `还有 ${list.length - shown.length} 个生词，到生词本里查看。`;
    box.append(more);
  }
}

function paint() {
  paintStats();
  paintSlots();
  paintAnswer();
  paintPlay();
  paintReport();
  paintNotes();
  document.getElementById("dict-uk").classList.toggle("active", dict.accent === "uk");
  document.getElementById("dict-us").classList.toggle("active", dict.accent === "us");
}

function stopTimer() {
  clearInterval(dict.timer);
  dict.timer = 0;
}

function startTimer() {
  stopTimer();
  dict.timer = setInterval(() => {
    if (dict.sessionDone) {
      stopTimer();
      return;
    }
    dict.spendSecond += 1;
    paintStats();
  }, 1000);
}

function loadWord(index) {
  dict.index = index;
  dict.input = "";
  dict.complete = false;
  dict.correct = false;
  dict.revealed = false;
  document.getElementById("dict-reveal").hidden = false;
  paint();
  setTimeout(() => { if (current() && !dict.sessionDone) speak(current().word); }, 500);
}

function begin(words, review, kind, options = {}) {
  stopSpeak();
  const startIndex = Number.isInteger(options.startIndex) ? options.startIndex : 0;
  dict.words = words;
  dict.review = review;
  dict.kind = kind || (review ? "review" : "unit");
  dict.screen = "session";
  dict.sessionDone = false;
  dict.skipped = false;
  // 续听：results 是已经判过的连续前缀，下标就是下一个该听的词。
  dict.results = Array.isArray(options.results) ? options.results.slice() : [];
  dict.spendSecond = Math.max(0, Math.floor(Number(options.elapsedSeconds) || 0));
  dict.hooks = {
    onGrade: typeof options.onGrade === "function" ? options.onGrade : null,
    onFinish: typeof options.onFinish === "function" ? options.onFinish : null,
    onProgress: typeof options.onProgress === "function" ? options.onProgress : null
  };
  dict.dailyFinished = false;
  dict.started = true;
  document.getElementById("dict-picker").hidden = true;
  document.getElementById("dict-stats").hidden = false;
  document.getElementById("dict-progress").hidden = false;
  document.getElementById("dict-card").hidden = false;
  document.getElementById("dict-report").hidden = true;
  startTimer();
  const back = document.getElementById("dict-back");
  if (back) back.textContent = dict.origin === "notebook" || dict.origin === "daily" ? "返回生词本" : "返回单元";
  const index = Math.max(0, Math.min(startIndex, words.length));
  if (words.length && index >= words.length) { finishSession(); return; }
  if (words.length) loadWord(index);
  else paint();
}

function startNotebookDictation(words, sourceLabel) {
  const list = DictationModel.notebookSessionWords(words);
  if (!list.length) return false;
  dict.origin = "notebook";
  dict.notebookWords = list;
  dict.sessionSource = sourceLabel || DictationModel.notebookDayLabel("");
  View.setHeading("单词听写", DictationModel.DICTATION_SUBTITLE);
  begin(list, false, "notebook");
  View.show("dictation");
  return true;
}

// 每日生词听写。词表、已判结果和用时都由调用方（生词本）从计划里取，
// 这里只负责把这轮听写跑起来，并在判词/完成时回调 ——
// 调度和存储都留在 home.js 那一侧，听写模块不认识 localStorage。
function startDailyDictation(options = {}) {
  const { day, words, results, elapsedSeconds, onGrade, onFinish, onProgress } = options;
  const list = DictationModel.notebookSessionWords(words);
  if (!list.length) return false;
  dict.origin = "daily";
  dict.daily = { day: typeof day === "string" ? day : "" };
  dict.sessionSource = DictationModel.dailySourceLabel(day);
  View.setHeading("每日生词听写", "今天的复习词和今天新收的词，按计划听写。");
  begin(list, false, "daily", {
    startIndex: Array.isArray(results) ? results.length : 0,
    results,
    elapsedSeconds,
    onGrade,
    onFinish,
    onProgress
  });
  View.show("dictation");
  return true;
}

function openUnit(unitNumber) {
  const screen = DictationModel.startUnit(dict.boardId, unitNumber);
  dict.boardId = screen.boardId;
  dict.unitNumber = screen.unitNumber;
  const words = boardById(dict.boardId).units[unitNumber - 1].words.map((item) => ({ ...item }));
  begin(words, false);
}

function startReview(words) {
  const screen = DictationModel.startReview(dict.boardId, dict.unitNumber);
  dict.boardId = screen.boardId;
  dict.unitNumber = screen.unitNumber;
  const set = new Set(words);
  const list = boardById(dict.boardId).units[dict.unitNumber - 1].words
    .filter((item) => set.has(item.word))
    .map((item) => ({ ...item }));
  begin(list, true);
}

function finishSession() {
  dict.sessionDone = true;
  stopTimer();
  stopSpeak();
  const outcome = DictationModel.sessionOutcome(
    { kind: dict.kind, boardId: dict.boardId, unitNumber: dict.unitNumber },
    dict.results.length
  );
  if (outcome.mark) {
    persistJson(
      DictationModel.unitDoneKey(),
      DictationModel.markUnitDone(DictationModel.readUnitDone(rawDone()), outcome.boardId, outcome.unitNumber)
    );
  }
  // 只报一次。复习错词那一轮没有 onFinish，不会把档位再推进一遍。
  if (!dict.dailyFinished && dict.kind === "daily"
    && dict.hooks && typeof dict.hooks.onFinish === "function") {
    dict.dailyFinished = true;
    try {
      dict.hooks.onFinish({ elapsedSeconds: dict.spendSecond });
    } catch (error) {
      console.warn("每日听写结果没能保存", error);
    }
  }
  paint();
}

function paintPicker() {
  const boards = document.getElementById("dict-boards");
  const units = document.getElementById("dict-units");
  boards.replaceChildren();
  units.replaceChildren();
  DictationWords.forEach((board) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode";
    button.dataset.board = board.id;
    button.textContent = board.name;
    button.classList.toggle("active", board.id === dict.boardId);
    button.addEventListener("click", () => {
      const screen = DictationModel.selectBoard(board.id);
      dict.boardId = screen.boardId;
      dict.screen = screen.screen;
      paintPicker();
    });
    boards.appendChild(button);
  });
  const board = boardById(dict.boardId);
  const done = DictationModel.readUnitDone(rawDone());
  board.units.forEach((unit, index) => {
    const number = index + 1;
    const range = DictationModel.unitRange(number);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "unit-card";
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = `第 ${number} 组`;
    const rangeLine = document.createElement("span");
    rangeLine.className = "hint";
    rangeLine.textContent = `词汇 ${range.start}\u2013${range.end}`;
    const count = document.createElement("span");
    count.className = "hint";
    count.textContent = "20 词";
    text.append(title, rangeLine, count);
    card.appendChild(text);
    if (DictationModel.isUnitDone(done, board.id, number)) {
      const mark = document.createElement("span");
      mark.className = "unit-check";
      mark.textContent = "✓";
      card.appendChild(mark);
    }
    card.addEventListener("click", () => openUnit(number));
    units.appendChild(card);
  });
}

function goNext() {
  if (dict.screen !== "session" || dict.words.length === 0) return;
  if (dict.index + 1 < dict.words.length) {
    loadWord(dict.index + 1);
    return;
  }
  finishSession();
}

function completeWord() {
  const word = current();
  if (!word || dict.complete) return;
  const expected = [...word.word].filter((char) => char !== " ").join("");
  const matched = dict.input.toLowerCase() === expected.toLowerCase();
  dict.complete = true;
  dict.correct = matched;
  dict.results.push({ word: word.word, isCorrect: matched });
  recordDailyGrade(word.word, matched);
  paint();
}

function reveal() {
  const word = current();
  if (!word || dict.complete) return;
  dict.input = "";
  dict.revealed = true;
  dict.complete = true;
  dict.correct = false;
  dict.skipped = true;
  dict.results.push({ word: word.word, isCorrect: false });
  recordDailyGrade(word.word, false);
  paint();
}

function onKey(event) {
  if (document.body.dataset.view !== "dictation") return;
  const target = event.target;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
  if (dict.screen !== "session" || dict.words.length === 0) return;
  if (event.altKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    const word = current();
    if (word && !dict.sessionDone) speak(word.word);
    return;
  }
  if (dict.sessionDone) return;
  if (dict.complete && event.key === "Enter") {
    if (target?.closest?.("button")) return;
    event.preventDefault();
    if (!dict.correct) saveNote(current());
    goNext();
    return;
  }
  if (dict.complete) return;
  if (event.key === "Backspace") {
    dict.input = dict.input.slice(0, -1);
    event.preventDefault();
    paintSlots();
    return;
  }
  if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
  const word = current();
  if (!word || event.key === " ") {
    event.preventDefault();
    return;
  }
  const expected = lettersOf(word.word);
  if (dict.input.length >= expected) return;
  dict.input += event.key;
  event.preventDefault();
  const plain = [...word.word].filter((char) => char !== " ").join("");
  if (dict.input.toLowerCase() === plain.toLowerCase() || dict.input.length === expected) completeWord();
  else paintSlots();
}

function layout() {
  root.innerHTML = `
    <section id="dict-picker">
      <div class="dict-picker-head">
        <h2>选择单元</h2>
        <p class="hint">共 25 组 · 500 词</p>
      </div>
      <div class="dict-groups" id="dict-boards"></div>
      <div class="dict-units" id="dict-units"></div>
    </section>
    <div class="metrics" id="dict-stats" hidden></div>
    <p id="dict-progress" class="hint" hidden></p>
    <section class="stage dict-card" id="dict-card" hidden>
      <div class="dict-audio">
        <button type="button" id="dict-play">播放单词发音</button>
        <button type="button" id="dict-uk" class="mode active">英式</button>
        <button type="button" id="dict-us" class="mode">美式</button>
      </div>
      <div id="dict-slots" class="slots"></div>
      <p class="hint">键入单词拼写，Backspace 可回退，Alt+R 重听。答题后显示柯林斯注释，发音由浏览器朗读。</p>
      <div class="dialog-actions">
        <button type="button" id="dict-reveal">看答案</button>
        <button type="button" id="dict-back">返回单元</button>
      </div>
      <div id="dict-answer" hidden></div>
    </section>
    <section class="review" id="dict-report" hidden></section>
    <section id="dict-notes"></section>
  `;
  paintPicker();
  document.getElementById("dict-back").addEventListener("click", backToUnits);
  document.getElementById("dict-play").addEventListener("click", () => {
    if (dict.playing) stopSpeak();
    else if (current()) speak(current().word);
  });
  document.getElementById("dict-uk").addEventListener("click", () => { dict.accent = "uk"; if (current()) speak(current().word); paint(); });
  document.getElementById("dict-us").addEventListener("click", () => { dict.accent = "us"; if (current()) speak(current().word); paint(); });
  document.getElementById("dict-reveal").addEventListener("click", reveal);
  document.addEventListener("keydown", onKey);
  // 切走或关页面时把这一轮用时存一次，免得刷新后从零开始计。
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDailyProgress();
  });
  window.addEventListener("pagehide", flushDailyProgress);
}

function showDictation() {
  View.setHeading("单词听写", DictationModel.DICTATION_SUBTITLE);
  stopTimer();
  stopSpeak();
  const screen = DictationModel.enterDictation();
  dict.boardId = screen.boardId;
  dict.index = 0;
  dict.words = [];
  showPicker();
  // 换页、停时钟、切换 tab、画面包屑都归 View 管了
  View.show("dictation");
}

function showTyping() {
  View.setHeading("打字练习", "按原文逐字输入。错字会标红并继续前进，Backspace 可以回退。");
  stopTimer();
  stopSpeak();
  const screen = DictationModel.enterDictation();
  dict.boardId = screen.boardId;
  dict.screen = screen.screen;
  dict.index = 0;
  dict.words = [];
  dict.started = false;
  dict.sessionDone = false;
  clearAttempt();
  View.show("typing");
  // 先显示出来再量：隐藏时 #stage 宽度是 0，measureLine 会直接返回，
  // 行长就会一直停在默认值上。这一步不能省。
  measureLine();
  document.getElementById("stage").focus();
}

layout();
document.getElementById("view-dictation").addEventListener("click", showDictation);
document.getElementById("view-typing").addEventListener("click", showTyping);

// 首页和基础练习从这里进来，走的是同一套复位逻辑
View.register("typing", showTyping);
View.register("dictation", showDictation);

export { startNotebookDictation, startDailyDictation };
