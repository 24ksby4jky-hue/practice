import * as TypingModel from "./typing-model.js";

function keysFor(id) {
  return TypingModel.storageKeys(id);
}

function currentId() {
  return state.articles[state.articleIndex]?.id || "";
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

const ARTICLES = [
  {
    id: "morning-platform",
    title: "Morning Platform",
    category: "日常短文",
    label: "车站",
    content: "The morning train was two minutes late, which was enough time for Lin to finish tying a shoelace and still catch the doors. She found a seat by the window and watched the platform slide away. A student across the aisle was mouthing vocabulary, tapping one finger for each stressed syllable. Lin opened her notebook and copied the same habit, speaking only in her head. By the third stop the carriage had filled, and the quiet practice turned into a small contest with the rattling wheels."
  },
  {
    id: "library-desk",
    title: "Library Desk",
    category: "日常短文",
    label: "图书馆",
    content: "The desk lamp made a warm circle on the page and left the rest of the room dim. Chen set a glass of water just outside that circle so he would not knock it over while typing. He read one sentence, looked away, and typed it from memory. When a word came out wrong he did not delete the whole line. He backed up one letter, fixed it, and continued. The rule was simple: speed was allowed only after the sentence was clean."
  },
  {
    id: "city-bike-lanes",
    title: "City Bike Lanes",
    category: "说明段落",
    label: "说明",
    content: "The chart compares weekly bicycle trips in three districts over one spring. Harbor District starts lowest, then rises sharply after the new riverside lane opens in week three. Market District stays almost flat, because its streets remain narrow and shared with delivery vans. Hill District grows slowly and passes Market District in the final week. The main change is not the weather. It is the protected lane, which makes short trips feel safe enough for people who used to walk."
  },
  {
    id: "workshop-hours",
    title: "Workshop Hours",
    category: "说明段落",
    label: "流程",
    content: "The workshop runs in four blocks. Block one is a timed copy of a short paragraph. Block two reviews the letters that caused the most errors. Block three repeats only the sentences that contained those letters. Block four is an untimed pass where accuracy matters more than pace. A session ends when the final pass stays above ninety percent, or when the clock reaches forty minutes. Leaving early discards the current pass and keeps only finished sessions."
  },
  {
    id: "slow-on-purpose",
    title: "Slow on Purpose",
    category: "观点练习",
    label: "观点",
    content: "People often treat typing speed as the whole skill, but a fast wrong sentence still has to be repaired. In an exam the repair costs more time than the original caution. A steadier method is to keep the eyes one word ahead of the fingers and to refuse a guess when the letter is unclear. Speed grows later, after the hands stop inventing characters. The useful target is a pace you can hold for several minutes without a sudden burst of mistakes."
  },
  {
    id: "notes-you-can-trust",
    title: "Notes You Can Trust",
    category: "观点练习",
    label: "笔记",
    content: "A typed note is only helpful if another person can read it without asking what you meant. That is why accuracy belongs in the first draft, not in a later cleanup that may never happen. Short sentences, ordinary words, and a pause at each comma keep the text honest. If a name or number is uncertain, mark it instead of inventing a likely version. The habit looks slow on the first day and saves a long correction on the second."
  }
];

const state = {
  articles: ARTICLES.map((item) => ({ ...item })),
  articleIndex: 0,
  input: "",
  lines: [],
  chars: [],
  totalCount: 0,
  lineMax: 62,
  mode: "free",
  typingStarted: false,
  sound: true,
  reviewOpen: false,
  reviewTab: "current",
  pickerOpen: true,
  fontSize: "16px",
  wrongRecords: [],
  errorsCommitted: false,
  statsCommitted: false,
  comboId: 0,
  clock: { accumulatedMs: 0, running: false, segmentStartedAt: null },
  timerId: 0,
  timedMin: 1,
  timedSec: 0,
  timedApplied: false,
  timedFinished: false,
  finishTime: "",
  lastReview: null,
  resultOpen: false,
  exitOpen: false,
  lastLockText: ""
};

const $ = (id) => document.getElementById(id);

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function formatTime(total) {
  const safe = Math.max(0, Math.floor(total));
  const m = String(Math.floor(safe / 60)).padStart(2, "0");
  const s = String(safe % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function layout(text, maxChars) {
  return TypingModel.layout(text, maxChars);
}

function nowMs() {
  return Date.now();
}

function elapsedSecond() {
  return Math.floor(TypingModel.elapsedMs(state.clock, nowMs()) / 1000);
}

function timedDuration() {
  return state.timedMin * 60 + state.timedSec;
}

function currentTimedRemain() {
  if (!state.timedApplied) return 0;
  return TypingModel.timedRemainSeconds(timedDuration(), TypingModel.elapsedMs(state.clock, nowMs()));
}

function pauseTypingClock() {
  state.clock = TypingModel.pauseTimer(state.clock, nowMs());
}

function resumeTypingClock() {
  const resume = TypingModel.shouldResume({
    mode: state.mode,
    typingStarted: state.typingStarted,
    timedApplied: state.timedApplied,
    finished: state.timedFinished || state.resultOpen
  });
  if (!resume) return;
  state.clock = TypingModel.resumeTimer(state.clock, nowMs());
}

function trailingCombo(chars, input) {
  return TypingModel.trailingCombo(chars, input);
}

function maxCombo(chars, input) {
  return TypingModel.maxCombo(chars, input);
}

function liveStats() {
  const typed = state.input.length;
  const correct = [...state.input].reduce((sum, char, index) => (
    sum + (state.chars[index]?.char === char ? 1 : 0)
  ), 0);
  const accuracy = typed > 0 ? Math.round((correct / typed) * 100) : 100;
  const wpm = TypingModel.wpm(state.input, elapsedSecond());
  const combo = trailingCombo(state.chars, state.input);
  let pace = "顺手";
  if (wpm <= 0) pace = "热身中";
  else if (combo >= 30 || (wpm >= 30 && accuracy >= 90)) pace = "加速";
  return {
    completed: typed,
    total: state.totalCount || state.chars.length,
    accuracy,
    accuracyText: `${accuracy}%`,
    wpm,
    pace,
    paceSub: `${wpm} WPM · ${wpm < 30 ? "明朗起步" : "节奏稳定"}`,
    combo,
    comboPercent: Math.min(100, combo * 5),
    clock: state.mode === "timed"
      ? formatTime(currentTimedRemain())
      : formatTime(elapsedSecond())
  };
}

function countExpected(records) {
  return records.reduce((map, record) => {
    const key = record.expected === " " ? "空格" : record.expected.toLowerCase();
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
}

function topWrong(map, limit = 8) {
  const total = Object.values(map).reduce((sum, n) => sum + n, 0);
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      percent: total ? Math.round((count / total) * 100) : 0
    }));
}

function sessionHeat(map) {
  const heat = {};
  Object.entries(map).forEach(([key, count]) => {
    if (!/^[a-z]$/.test(key)) return;
    heat[key] = count >= 3 ? "high" : count === 2 ? "medium" : count === 1 ? "low" : "none";
  });
  return heat;
}

function ratioHeat(map) {
  const entries = Object.entries(map).filter(([key]) => /^[a-z]$/.test(key));
  const max = entries.reduce((best, [, count]) => Math.max(best, count), 0);
  const heat = {};
  entries.forEach(([key, count]) => {
    if (count <= 0 || max <= 0) heat[key] = "none";
    else {
      const ratio = count / max;
      heat[key] = ratio >= 0.6 ? "high" : ratio >= 0.3 ? "medium" : "low";
    }
  });
  return heat;
}

function reviewStats() {
  const typed = state.input.length;
  const correct = [...state.input].reduce((sum, char, index) => (
    sum + (state.chars[index]?.char === char ? 1 : 0)
  ), 0);
  const counts = countExpected(state.wrongRecords);
  return {
    finalWpm: String(TypingModel.wpm(state.input, elapsedSecond())),
    accuracyText: `${typed > 0 ? Math.round((correct / typed) * 100) : 100}%`,
    totalWrongCount: state.wrongRecords.length,
    maxCombo: maxCombo(state.chars, state.input),
    topWrongChars: topWrong(counts),
    keyboardHeat: sessionHeat(counts)
  };
}

function displayReview() {
  if (!state.input.length && state.lastReview) return state.lastReview;
  return reviewStats();
}

function loadCumulative() {
  return readJson(keysFor(currentId()).errors, {}).charCounts || {};
}

function loadArticleStats() {
  return TypingModel.articleStatsFromStorage(readJson(keysFor(currentId()).stats, { byId: {} }));
}

function cumulativeReview() {
  const counts = loadCumulative();
  const stat = loadArticleStats().byId[currentId()];
  const practiceCount = stat?.practiceCount || 0;
  return {
    practiceCount,
    bestWpm: String(stat?.bestWpm || 0),
    avgWpm: String(TypingModel.averageWpm(stat)),
    bestAccuracyText: `${stat?.bestAccuracy || 0}%`,
    avgAccuracyText: `${practiceCount ? Math.round((stat.accuracySum || 0) / practiceCount) : 0}%`,
    topWrongChars: topWrong(counts),
    keyboardHeat: ratioHeat(counts),
    totalWrongCount: Object.values(counts).reduce((sum, n) => sum + n, 0)
  };
}

function resultFeedback(score) {
  if (score <= 2) return { pill: "打基础", desc: "准确率还有较大提升空间，建议放慢节奏，先保证每个字母都打对，速度可以后面再追。", tier: "考场萌新" };
  if (score <= 4) return { pill: "找节奏", desc: "错误率偏高，试着盯紧光标位置，减少漏看和抢打，准确率上来后速度自然会提升。", tier: "逐步适应" };
  if (score <= 6) return { pill: "稳步进步", desc: "准确率过半，已经有基本手感，接下来重点练习常错的字母组合，减少重复失误。", tier: "进阶练习者" };
  if (score <= 8) return { pill: "稳定提升", desc: "准确率已经不错了，接下来重点练节奏连贯性和长段稳定输出。", tier: "稳健选手" };
  return { pill: "表现优秀", desc: "准确率非常出色，可以适当提速，向更高的打字速度发起挑战了。", tier: "考场高手" };
}

function groups() {
  const list = [];
  state.articles.forEach((article, index) => {
    let group = list.find((item) => item.label === article.category);
    if (!group) {
      group = { label: article.category, items: [] };
      list.push(group);
    }
    group.items.push({ ...article, globalIndex: index });
  });
  return list;
}

function isInputLocked() {
  return state.mode === "timed" && (state.timedFinished || (!state.timedApplied && timedDuration() <= 0));
}

function timedHint() {
  if (state.timedFinished) return "时间到，已生成复盘";
  if (state.timedApplied) return `剩余 ${formatTime(currentTimedRemain())}`;
  if (timedDuration() <= 0) return "请先设置挑战时长";
  return "开始打字即可计时";
}

function showToast(text) {
  const toast = $("toast");
  toast.hidden = false;
  toast.textContent = text;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 1800);
}

function persistJson(key, value) {
  const ok = TypingModel.writeJson(localStorage, key, value);
  if (!ok) showToast("本地记录没能保存");
  return ok;
}

let audioCtx;
async function audio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  return audioCtx;
}

async function playCorrect() {
  try {
    const ctx = await audio();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1568, t);
    osc.frequency.exponentialRampToValueAtTime(1046, t + 0.04);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.34, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.055);
  } catch (error) {
    console.warn("typing correct sound failed", error);
  }
}

async function playWrong() {
  try {
    const ctx = await audio();
    const t = ctx.currentTime;
    const high = ctx.createOscillator();
    high.type = "triangle";
    high.frequency.setValueAtTime(240, t);
    high.frequency.exponentialRampToValueAtTime(180, t + 0.08);
    const highGain = ctx.createGain();
    highGain.gain.setValueAtTime(0.399, t);
    highGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    const low = ctx.createOscillator();
    low.type = "sine";
    low.frequency.setValueAtTime(120, t);
    low.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    const lowGain = ctx.createGain();
    lowGain.gain.setValueAtTime(0.147, t);
    lowGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    high.connect(highGain);
    highGain.connect(ctx.destination);
    low.connect(lowGain);
    lowGain.connect(ctx.destination);
    high.start(t);
    low.start(t);
    high.stop(t + 0.09);
    low.stop(t + 0.1);
  } catch (error) {
    console.warn("typing wrong sound failed", error);
  }
}

function persistErrors() {
  const merged = { ...loadCumulative() };
  Object.entries(countExpected(state.wrongRecords)).forEach(([key, count]) => {
    merged[key] = (merged[key] || 0) + count;
  });
  persistJson(keysFor(currentId()).errors, { version: 1, charCounts: merged });
}

function persistArticleStat() {
  const stats = reviewStats();
  const wpmValue = Number(stats.finalWpm) || 0;
  const accuracy = Number(stats.accuracyText.replace("%", "")) || 0;
  const store = loadArticleStats();
  const id = currentId();
  store.byId[id] = TypingModel.applyPracticeStat(store.byId[id] || TypingModel.emptyPracticeStat(), {
    wpm: wpmValue,
    accuracy,
    elapsedSecond: elapsedSecond()
  });
  persistJson(keysFor(id).stats, store);
}

function captureReview() {
  if (!state.input.length) return;
  state.lastReview = reviewStats();
  persistJson(keysFor(currentId()).review, state.lastReview);
}

function commitErrors() {
  if (state.errorsCommitted || !state.wrongRecords.length) return;
  persistErrors();
  state.errorsCommitted = true;
}

function commitStats() {
  if (state.statsCommitted) return;
  persistArticleStat();
  state.statsCommitted = true;
}

function loadReviewSnapshot() {
  state.lastReview = readJson(keysFor(currentId()).review, null);
}

function clearPractice() {
  state.wrongRecords = [];
  state.errorsCommitted = false;
  state.statsCommitted = false;
  state.reviewOpen = false;
  state.resultOpen = false;
  state.timedFinished = false;
  state.comboId = 0;
  state.typingStarted = false;
  state.finishTime = "";
  if (state.mode === "timed") {
    state.timedApplied = false;
  }
  state.clock = { accumulatedMs: 0, running: false, segmentStartedAt: null };
}

function startTimer() {
  clearInterval(state.timerId);
  state.timerId = setInterval(() => {
    const visible = TypingModel.isTypingView(document.body.dataset.view);
    const remain = currentTimedRemain();
    const wasRunning = state.clock.running;
    if (visible && state.mode === "timed" && state.timedApplied && wasRunning && !state.timedFinished && remain <= 0) {
      finishSession();
      render();
      return;
    }
    if (wasRunning) render();
  }, 250);
}

function applyArticle(index) {
  state.articleIndex = index;
  state.input = "";
  measureLine();
  clearPractice();
  loadReviewSnapshot();
  const built = layout(state.articles[index].content, state.lineMax);
  state.lines = built.lines;
  state.chars = built.chars;
  state.totalCount = built.totalCount;
  startTimer();
  render();
}

function startPracticeIfNeeded() {
  if (state.mode === "timed") {
    if (!state.timedApplied && !state.timedFinished && timedDuration() > 0) {
      state.timedApplied = true;
      state.clock = { accumulatedMs: 0, running: false, segmentStartedAt: null };
      state.clock = TypingModel.resumeTimer(state.clock, nowMs());
      state.reviewOpen = false;
    } else if (state.timedApplied && !state.clock.running && !state.timedFinished) {
      state.clock = TypingModel.resumeTimer(state.clock, nowMs());
    }
    return;
  }
  state.typingStarted = true;
  state.clock = TypingModel.resumeTimer(state.clock, nowMs());
}

function endOfLineSpace(index) {
  const current = state.chars[index];
  if (!current || current.char !== " ") return false;
  const next = state.chars[index + 1];
  return !next || next.line !== current.line;
}

function triggerWrong(expected, actual, index) {
  state.wrongRecords.push({ expected, actual, index, timestamp: Date.now() });
  if (state.sound) playWrong();
}

function triggerCorrect() {
  state.comboId += 1;
  if (state.sound) playCorrect();
}

function finishSession() {
  const remain = currentTimedRemain();
  const elapsed = elapsedSecond();
  const expired = state.mode === "timed" && state.timedApplied && remain <= 0;
  const visible = TypingModel.isTypingView(document.body.dataset.view);
  const allowed = TypingModel.shouldPersist({
    inputLength: state.input.length,
    totalCount: state.totalCount,
    timedExpired: expired,
    typingViewVisible: visible
  });
  if (!allowed) return;
  pauseTypingClock();
  state.finishTime = formatTime(elapsed);
  state.reviewTab = "current";
  state.reviewOpen = false;
  state.resultOpen = true;
  state.typingStarted = false;
  if (state.mode === "timed") state.timedFinished = true;
  persistJson(keysFor(currentId()).done, true);
  captureReview();
  commitErrors();
  commitStats();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function onKeyDown(event) {
  if (document.body.dataset.view !== "typing") return;
  const target = event.target;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
  if (state.resultOpen || state.exitOpen) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (isInputLocked()) {
    event.preventDefault();
    const hint = timedHint();
    if (hint !== state.lastLockText) {
      state.lastLockText = hint;
      showToast(hint);
    }
    return;
  }
  state.lastLockText = "";
  const expected = state.chars[state.input.length];
  const key = event.key;
  if (key === "Backspace") {
    state.input = state.input.slice(0, -1);
    state.wrongRecords = TypingModel.pruneWrongRecords(state.wrongRecords, state.input.length);
    event.preventDefault();
    render();
    return;
  }
  if (key === "Enter") {
    if (expected && expected.char === "\n") state.input += "\n";
    else if (endOfLineSpace(state.input.length)) {
      startPracticeIfNeeded();
      state.input += " ";
      triggerCorrect();
      if (state.input.length === state.totalCount) finishSession();
    }
    event.preventDefault();
    render();
    return;
  }
  if (key.length !== 1) return;
  if (!expected || expected.char === "\n") {
    event.preventDefault();
    return;
  }
  startPracticeIfNeeded();
  state.input += key;
  event.preventDefault();
  if (key !== expected.char) triggerWrong(expected.char, key, expected.index);
  else triggerCorrect();
  if (state.input.length === state.totalCount) finishSession();
  render();
}

function charClass(item) {
  const typed = state.input[item.index];
  if (typed !== undefined) return typed === item.char ? "ok" : "bad";
  if (item.index === state.input.length) return "caret";
  return "wait";
}

function renderStage() {
  const stage = $("stage");
  stage.style.fontSize = state.fontSize;
  stage.replaceChildren();
  state.lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "line";
    line.forEach((item) => {
      const span = document.createElement("span");
      span.className = `ch ${charClass(item)}`;
      span.textContent = item.char === "\n" ? "↵" : item.char;
      if (item.index === state.input.length) span.id = "caret";
      row.appendChild(span);
    });
    stage.appendChild(row);
  });
  const caret = $("caret");
  if (caret) caret.scrollIntoView({ block: "nearest" });
}

function renderStats() {
  const stats = liveStats();
  $("stats").innerHTML = [
    ["当前节奏", stats.pace, stats.paceSub],
    ["已完成/总字符", String(stats.completed), `/${stats.total}`],
    ["准确率", stats.accuracyText, ""],
    ["时间", stats.clock, ""]
  ].map(([label, value, extra], index) => `
    <div class="stat">
      <span>${label}</span>
      <strong class="${index === 2 ? "good" : ""} ${index === 3 ? "time" : ""}">${value}${index === 1 ? `<small>${extra}</small>` : ""}</strong>
      ${index === 0 ? `<small>${extra}</small>` : ""}
    </div>
  `).join("");
  $("combo").innerHTML = `
    <div class="combo-track"><i style="width:${stats.comboPercent}%"></i></div>
    <b>连击 ×${stats.combo}</b>
    ${stats.combo >= 6 ? `<span class="combo-pop">×${stats.combo}</span>` : ""}
  `;
}

function renderPicker() {
  const article = state.articles[state.articleIndex];
  const group = groups().find((item) => item.label === article.category);
  const localIndex = group.items.findIndex((item) => item.globalIndex === state.articleIndex);
  const done = state.articles.filter((item) => localStorage.getItem(keysFor(item.id).done) === "true").length;
  $("picker-title").textContent = `选择练习文章 · ${article.category} ${String(localIndex + 1).padStart(2, "0")}`;
  $("picker-meta").textContent = `共 ${state.articles.length} 篇 · 已练习 ${done}`;
  $("picker-panel").classList.toggle("closed", !state.pickerOpen);
  $("picker-panel").replaceChildren();
  groups().forEach((item) => {
    const box = document.createElement("div");
    box.className = "group";
    const title = document.createElement("h3");
    title.textContent = item.label;
    const row = document.createElement("div");
    row.className = "articles";
    item.items.forEach((articleItem) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `article${articleItem.globalIndex === state.articleIndex ? " current" : ""}`;
      const name = document.createElement("strong");
      name.textContent = articleItem.title;
      const meta = document.createElement("em");
      meta.textContent = localStorage.getItem(keysFor(articleItem.id).done) === "true" ? "已练习" : articleItem.label;
      button.append(name, meta);
      button.addEventListener("click", () => applyArticle(articleItem.globalIndex));
      row.appendChild(button);
    });
    box.append(title, row);
    $("picker-panel").appendChild(box);
  });
}

function wrongTable(rows) {
  if (!rows.length) return `<tr><td class="empty" colspan="3">暂无错误记录</td></tr>`;
  return rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${row.percent}%</td></tr>`).join("");
}

function heatKeys(heat) {
  return `<div class="keys">${KEY_ROWS.map((row) => `
    <div class="key-row">${[...row].map((key) => `<div class="key ${heat[key] || "none"}">${key}</div>`).join("")}</div>
  `).join("")}</div>
  <div class="legend"><span><i class="swatch low"></i>少量</span><span><i class="swatch medium"></i>中等</span><span><i class="swatch high"></i>高频</span></div>`;
}

function metric(value, label) {
  return `<div class="metric"><b>${value}</b><span>${label}</span></div>`;
}

function renderReview() {
  const review = $("review");
  review.hidden = !state.reviewOpen;
  if (!state.reviewOpen) return;
  const current = displayReview();
  const cumul = cumulativeReview();
  const body = state.reviewTab === "current" ? `
    <div class="metrics">
      ${metric(current.finalWpm, "最终 WPM")}
      ${metric(current.accuracyText, "准确率")}
      ${metric(current.totalWrongCount, "总错误数")}
      ${metric(current.maxCombo, "最高连击")}
    </div>
    <h3>最易出错字母 TOP 8</h3>
    <table><thead><tr><th>字母</th><th>打错次数</th><th>占错误比</th></tr></thead><tbody>${wrongTable(current.topWrongChars)}</tbody></table>
    <h3>键盘错误热力图</h3>
    ${heatKeys(current.keyboardHeat)}
  ` : `
    <div class="cumul-metrics">
      ${metric(cumul.practiceCount, "练习次数（本篇）")}
      ${metric(cumul.bestWpm, "最佳 WPM")}
      ${metric(cumul.avgWpm, "平均 WPM")}
      ${metric(cumul.bestAccuracyText, "最佳准确率")}
      ${metric(cumul.avgAccuracyText, "平均准确率")}
    </div>
    <h3>累计最易出错字母 TOP 8（全局）</h3>
    <table><thead><tr><th>字母</th><th>打错次数</th><th>占错误比</th></tr></thead><tbody>${wrongTable(cumul.topWrongChars)}</tbody></table>
    <h3>全局键盘错误热力图</h3>
    ${heatKeys(cumul.keyboardHeat)}
  `;
  review.innerHTML = `
    <h2>错误复盘分析</h2>
    <div class="tabs">
      <button type="button" data-tab="current" class="${state.reviewTab === "current" ? "primary" : ""}">当次</button>
      <button type="button" data-tab="cumulative" class="${state.reviewTab === "cumulative" ? "primary" : ""}">累计</button>
    </div>
    ${body}
  `;
  review.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewTab = button.dataset.tab;
      renderReview();
    });
  });
}

function renderResult() {
  const modal = $("result-modal");
  modal.hidden = !state.resultOpen;
  if (!state.resultOpen) return;
  const stats = displayReview();
  const accuracy = Number(String(stats.accuracyText).replace("%", "")) || 0;
  const score = Math.max(1, Math.min(10, Math.round(accuracy / 10)));
  const feedback = resultFeedback(score);
  $("result-pill").textContent = feedback.pill;
  $("result-desc").textContent = feedback.desc;
  $("result-score").textContent = String(score);
  $("result-tier").textContent = feedback.tier;
  $("result-metrics").innerHTML = [
    [stats.accuracyText, "准确率"],
    [stats.totalWrongCount, "错误次数"],
    [state.finishTime || formatTime(elapsedSecond()), "用时"]
  ].map(([value, label]) => metric(value, label)).join("");
}

function renderModes() {
  $("mode-free").classList.toggle("active", state.mode === "free");
  $("mode-timed").classList.toggle("active", state.mode === "timed");
  $("timed-controls").hidden = state.mode !== "timed";
  $("timed-min").disabled = state.timedApplied;
  $("timed-sec").disabled = state.timedApplied;
  $("timed-min").value = String(state.timedMin);
  $("timed-sec").value = String(state.timedSec);
  $("timed-hint").textContent = timedHint();
  $("sound-btn").textContent = state.sound ? "声音已开启" : "声音已关闭";
  $("exit-modal").hidden = !state.exitOpen;
}

function render() {
  renderModes();
  renderStats();
  renderPicker();
  renderStage();
  renderReview();
  renderResult();
}

function measureLine() {
  if (state.input.length > 0) return;
  const stage = $("stage");
  const probe = document.createElement("span");
  probe.textContent = "0";
  probe.style.visibility = "hidden";
  probe.style.fontSize = state.fontSize;
  stage.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  const style = getComputedStyle(stage);
  const inner = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  if (inner <= 0 || width <= 0) return;
  const next = Math.max(20, Math.floor(inner / width));
  if (Math.abs(next - state.lineMax) <= 1) return;
  state.lineMax = next;
  const built = layout(state.articles[state.articleIndex].content, state.lineMax);
  state.lines = built.lines;
  state.chars = built.chars;
  state.totalCount = built.totalCount;
  render();
}

function switchMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  state.input = "";
  measureLine();
  clearPractice();
  startTimer();
  render();
}

function resetArticle() {
  state.input = "";
  measureLine();
  clearPractice();
  startTimer();
  render();
}

function discardAndReset() {
  state.input = "";
  measureLine();
  clearPractice();
  state.exitOpen = false;
  startTimer();
  render();
}

// 换页时把两个浮层收起来，否则结果弹窗会盖在首页上。
// 它俩都是 position:fixed; inset:0 的全屏遮罩，不收掉点不动任何东西。
function closeTypingOverlays() {
  if (!state.resultOpen && !state.exitOpen) return;
  state.resultOpen = false;
  state.exitOpen = false;
  renderModes();
}

$("mode-free").addEventListener("click", () => switchMode("free"));
$("mode-timed").addEventListener("click", () => switchMode("timed"));
$("timed-min").addEventListener("change", (event) => {
  if (state.timedApplied) return;
  state.timedMin = clamp(Number(event.target.value), 0, 99);
  renderModes();
});
$("timed-sec").addEventListener("change", (event) => {
  if (state.timedApplied) return;
  state.timedSec = clamp(Number(event.target.value), 0, 59);
  renderModes();
});
$("sound-btn").addEventListener("click", () => {
  state.sound = !state.sound;
  renderModes();
});
$("font-size").addEventListener("change", (event) => {
  state.fontSize = event.target.value;
  measureLine();
  render();
});
$("picker-toggle").addEventListener("click", () => {
  state.pickerOpen = !state.pickerOpen;
  renderPicker();
});
$("review-btn").addEventListener("click", () => {
  state.reviewOpen = !state.reviewOpen;
  renderReview();
});
$("reset-btn").addEventListener("click", resetArticle);
$("exit-btn").addEventListener("click", () => {
  if (!state.input.length || state.timedFinished || state.resultOpen) return;
  state.exitOpen = true;
  renderModes();
});
$("exit-cancel").addEventListener("click", () => {
  state.exitOpen = false;
  renderModes();
});
// 离开打字台要去哪一页 —— 由 view.js 注入，而不是这里反向 import view.js。
// 两边互相 import 会成环，注入就没有这个问题。
let navigateAway = () => {};
function setNavigateAway(fn) {
  if (typeof fn === "function") navigateAway = fn;
}

$("exit-confirm").addEventListener("click", () => {
  discardAndReset();
  navigateAway("basic");
});
$("result-review").addEventListener("click", () => {
  state.resultOpen = false;
  state.reviewOpen = true;
  state.reviewTab = "current";
  render();
});
$("result-retry").addEventListener("click", () => {
  state.resultOpen = false;
  resetArticle();
});
$("custom-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const serialKey = keysFor("custom").customSerial;
  const serial = readJson(serialKey, 0);
  const next = TypingModel.nextCustomId(Number.isInteger(serial) ? serial : 0);
  const title = $("custom-title").value.trim() || `自定义 ${next.serial}`;
  const content = $("custom-body").value.trim();
  if (!content) return;
  persistJson(serialKey, next.serial);
  state.articles.push({
    id: next.id,
    title,
    category: "自己的文本",
    label: "自定义",
    content
  });
  $("custom-title").value = "";
  $("custom-body").value = "";
  applyArticle(state.articles.length - 1);
});
$("stage").addEventListener("click", () => $("stage").focus());
document.addEventListener("keydown", onKeyDown);
window.addEventListener("resize", measureLine);

// 打开落在哪一页由 home.js 决定。这里只把打字台准备好 —— 它此刻是隐藏的，
// 量不出宽度，所以 measureLine() 要等真正进入打字页时再调（见 showTyping）。
applyArticle(0);

// 听写、首页、视图切换都要写 localStorage 或控制打字台的时钟，走这几个出口
export { persistJson, pauseTypingClock, resumeTypingClock, closeTypingOverlays, setNavigateAway };