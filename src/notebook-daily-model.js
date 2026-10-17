import {
  DEFAULT_DAILY_COUNT, MAX_IMPORT_CHARS, STORE_VERSION,
  addDays, clampDailyCount, dayOf, dedupeHistory, emptyStore, isCalendarDay,
  levelOf, noteKey, pruneStore, readStoreValue, reviewOf, todayDay, gradeNotes,
  cleanPlan, cleanHistoryEntry, cleanNote, storeChars
} from "./notebook-model.js";
import { isDictationWord } from "./dictation/dictation-model.js";

// 每日计划是「今天听哪些词」的快照，不是词典副本：只存小写词串，
// 释义、音标、例句在开始听写时从词表现补。20 个词约 1.2KB/天。

function asStore(store) {
  return store && typeof store === "object" && !Array.isArray(store) ? store : emptyStore();
}

function dayOrToday(day) {
  return isCalendarDay(day) ? day : todayDay();
}

/* --------------------------------------------------------------------------
   候选词
   -------------------------------------------------------------------------- */

// 到期没到期。dueDay 为空串表示「立即到期」——刚收进来、还没安排过复习的词。
function isDue(review, today) {
  return review.dueDay === "" || review.dueDay <= today;
}

// 当天新收、还没听写过的词。当天听过一次之后就算复习词了。
function isFresh(note, review, today) {
  return review.lastAt === 0 && dayOf(note.at) === today;
}

// 同一个词形只留一条：优先已经复习得更深的，其次最近听写过的，再次最新加入的。
// 老数据里可能同时有 "Child" 和 "child"，两条都应该跟着同一次听写更新，
// 但计划里只能出现一次，否则听写时会连着考两遍。
function preferCandidate(a, b) {
  if (a.review.stage !== b.review.stage) return a.review.stage > b.review.stage ? a : b;
  if (a.review.lastAt !== b.review.lastAt) return a.review.lastAt > b.review.lastAt ? a : b;
  return (a.note.at || 0) >= (b.note.at || 0) ? a : b;
}

function candidatesOf(notes, today) {
  const list = Array.isArray(notes) ? notes : [];
  const byKey = new Map();
  for (const note of list) {
    if (!note || typeof note !== "object") continue;
    // 用户手动标了「记住了」的词不再安排复习；改回 0/1 档后重新参与。
    if (levelOf(note) === 2) continue;
    const key = noteKey(note.word);
    if (!isDictationWord(key)) continue;
    const review = reviewOf(note);
    if (!isDue(review, today)) continue;
    const candidate = { key, note, review };
    const existing = byKey.get(key);
    byKey.set(key, existing ? preferCandidate(existing, candidate) : candidate);
  }
  const fresh = [];
  const due = [];
  for (const item of byKey.values()) {
    if (isFresh(item.note, item.review, today)) fresh.push(item);
    else due.push(item);
  }
  // 复习词：拖得最久的先；同一天到期的按档位低的先；最后按加入时间固定顺序。
  due.sort((a, b) => (a.review.dueDay < b.review.dueDay ? -1 : a.review.dueDay > b.review.dueDay ? 1 : 0)
    || a.review.stage - b.review.stage
    || (a.note.at || 0) - (b.note.at || 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // 新词：按加入先后，早收进来的先听。
  fresh.sort((a, b) => (a.note.at || 0) - (b.note.at || 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { fresh, due };
}

function candidateSummary(notes, today) {
  const { fresh, due } = candidatesOf(notes, dayOrToday(today));
  return { newCount: fresh.length, dueCount: due.length, total: fresh.length + due.length };
}

// 新词最多占一半名额：既保证当天收的词有机会当天复习，又不让积压的旧词
// 被新词无限期挤到后面。一边不够就用另一边补足。
function allocate(freshCount, dueCount, count) {
  const cap = Math.min(Math.ceil(count / 2), count);
  let freshTake = Math.min(freshCount, cap);
  const dueTake = Math.min(dueCount, count - freshTake);
  freshTake = Math.min(freshCount, count - dueTake);
  return { freshTake, dueTake };
}

function buildPlanWords(notes, today, count) {
  const day = dayOrToday(today);
  const size = clampDailyCount(count);
  const { fresh, due } = candidatesOf(notes, day);
  const { freshTake, dueTake } = allocate(fresh.length, due.length, size);
  // 复习词在前：时间敏感的先做，中途退出也不亏。
  return due.slice(0, dueTake).map((item) => item.key)
    .concat(fresh.slice(0, freshTake).map((item) => item.key));
}

/* --------------------------------------------------------------------------
   计划
   -------------------------------------------------------------------------- */

function planProgress(plan) {
  const words = Array.isArray(plan && plan.words) ? plan.words : [];
  const results = Array.isArray(plan && plan.results) ? plan.results : [];
  const graded = Math.min(results.length, words.length);
  const correct = results.slice(0, graded).filter((item) => item && item.correct === true).length;
  return {
    total: words.length,
    graded,
    remaining: Math.max(0, words.length - graded),
    correct,
    wrong: graded - correct,
    accuracy: graded ? Math.round((correct / graded) * 100) : 0
  };
}

// 续听：结果总是词表的连续前缀，所以结果条数就是下一个该听的词的下标。
function resumeState(plan) {
  const progress = planProgress(plan);
  const results = (Array.isArray(plan && plan.results) ? plan.results : []).slice(0, progress.graded)
    .map((item) => ({ word: item.word, isCorrect: item.correct === true }));
  return {
    startIndex: progress.graded,
    results,
    elapsedSeconds: Math.max(0, Math.floor(Number(plan && plan.elapsedSeconds) || 0))
  };
}

// 只有点「开始今日听写」时才建计划；当天已经建过就原样复用 ——
// 中途改每日词量不会把已经开始的这一轮换掉。
function ensurePlan(store, today, atMs) {
  const base = asStore(store);
  const day = dayOrToday(today);
  const existing = base.plans && base.plans[day];
  if (existing && Array.isArray(existing.words) && existing.words.length) {
    return { store: base, plan: existing, created: false };
  }
  const count = clampDailyCount(base.settings && base.settings.dailyCount);
  const words = buildPlanWords(base.notes, day, count);
  if (!words.length) return { store: base, plan: null, created: false };
  const plan = {
    day,
    words,
    results: [],
    startedAt: Number.isFinite(atMs) ? atMs : 0,
    finishedAt: null,
    elapsedSeconds: 0,
    dailyCount: count,
    builtAt: Number.isFinite(atMs) ? atMs : 0
  };
  const next = pruneStore({ ...base, plans: { ...base.plans, [day]: plan } }, day);
  return { store: next, plan: next.plans[day], created: true };
}

// 计划里的词 → 可听写的词条。查不到生词（建计划后被删掉了）也给一条，
// 因为删掉它会把 results 的下标全部错位。
function dailySessionNotes(store, plan, lookup) {
  const base = asStore(store);
  const words = Array.isArray(plan && plan.words) ? plan.words : [];
  const find = typeof lookup === "function" ? lookup : () => null;
  const byKey = new Map();
  for (const note of base.notes) {
    const key = noteKey(note.word);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, note);
  }
  return words.map((word) => {
    const note = byKey.get(word);
    const found = find(word);
    return {
      word,
      meaning: note ? note.meaning : "",
      phonetic: found && typeof found.phonetic === "string" ? found.phonetic : "",
      pos: found && typeof found.pos === "string" ? found.pos : "",
      example: found && typeof found.example === "string" ? found.example : ""
    };
  });
}

// 一个词判完立刻入账。只有「下一个该判的词」才接受，避免同一词重复推进档位。
function applyGradeToStore(store, day, word, correct, atMs) {
  const base = asStore(store);
  const plan = base.plans && base.plans[day];
  if (!plan) return base;
  const key = noteKey(word);
  const position = plan.words.indexOf(key);
  if (position === -1 || position !== plan.results.length) return base;
  const hit = correct === true;
  return {
    ...base,
    notes: gradeNotes(base.notes, key, hit, day, atMs),
    plans: {
      ...base.plans,
      [day]: { ...plan, results: [...plan.results, { word: key, correct: hit, at: atMs }] }
    }
  };
}

function touchPlan(store, day, elapsedSeconds) {
  const base = asStore(store);
  const plan = base.plans && base.plans[day];
  if (!plan || plan.finishedAt) return base;
  const seconds = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  if (seconds === plan.elapsedSeconds) return base;
  return { ...base, plans: { ...base.plans, [day]: { ...plan, elapsedSeconds: seconds } } };
}

// 完成一轮。幂等：重复调用不会多写一条历史；一个词都没判过就不算完成。
function finishPlan(store, day, atMs, elapsedSeconds) {
  const base = asStore(store);
  const plan = base.plans && base.plans[day];
  if (!plan || plan.finishedAt) return base;
  const progress = planProgress(plan);
  if (!progress.graded) return base;
  const seconds = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  const missed = plan.results.filter((item) => !item.correct).map((item) => noteKey(item.word));
  const entry = {
    day,
    finishedAt: Number.isFinite(atMs) ? atMs : 0,
    planned: progress.total,
    graded: progress.graded,
    correct: progress.correct,
    accuracy: progress.accuracy,
    elapsedSeconds: seconds,
    missed
  };
  const history = [entry, ...base.history.filter((item) => item.day !== day)];
  return pruneStore({
    ...base,
    plans: { ...base.plans, [day]: { ...plan, finishedAt: entry.finishedAt, elapsedSeconds: seconds } },
    history
  }, day);
}

function dailyStatus(store, today) {
  const base = asStore(store);
  const day = dayOrToday(today);
  const summary = candidateSummary(base.notes, day);
  const dailyCount = clampDailyCount(base.settings && base.settings.dailyCount);
  const plan = base.plans && base.plans[day] ? base.plans[day] : null;
  if (!plan) {
    return {
      state: summary.total ? "ready" : "empty",
      plan: null,
      total: 0, graded: 0, remaining: 0, correct: 0, wrong: 0, accuracy: 0,
      ...summary,
      dailyCount,
      canStart: summary.total > 0
    };
  }
  const progress = planProgress(plan);
  const state = plan.finishedAt ? "done" : (progress.graded > 0 ? "in-progress" : "ready");
  return {
    state,
    plan,
    ...summary,
    ...progress,
    dailyCount,
    canStart: !plan.finishedAt
  };
}

/* --------------------------------------------------------------------------
   打卡与历史
   -------------------------------------------------------------------------- */

function doneDays(store) {
  const base = asStore(store);
  const days = new Set();
  for (const entry of base.history) {
    if (entry && entry.graded > 0 && isCalendarDay(entry.day)) days.add(entry.day);
  }
  for (const plan of Object.values(base.plans)) {
    if (!plan || !plan.finishedAt) continue;
    if (planProgress(plan).graded > 0 && isCalendarDay(plan.day)) days.add(plan.day);
  }
  return days;
}

// 连续天数从今天往前数；今天还没做的话从昨天开始数 —— 白天打开应用
// 看到「连续 0 天」会让人以为断签了，其实只是还没开始。
function streakOf(store, today) {
  const day = dayOrToday(today);
  const days = doneDays(store);
  let current = 0;
  let cursor = days.has(day) ? day : addDays(day, -1);
  while (cursor && days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const item of sorted) {
    run = previous && addDays(previous, 1) === item ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = item;
  }
  return { current, longest, totalDays: days.size };
}

// 日历格子的状态：done 完成 · partial 做了一部分 · missed 有计划没做 ·
// started 今天已开始未完成 · none 没有计划。红只留给批改，这里不用红。
function calendarDays(store, today, span = 30) {
  const base = asStore(store);
  const day = dayOrToday(today);
  const historyByDay = new Map();
  for (const entry of base.history) historyByDay.set(entry.day, entry);
  const out = [];
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const cursor = addDays(day, -offset);
    if (!cursor) continue;
    const plan = base.plans[cursor] || null;
    const progress = plan ? planProgress(plan) : null;
    const entry = historyByDay.get(cursor) || null;
    let state = "none";
    if (plan) {
      if (plan.finishedAt) state = "done";
      else if (progress.graded > 0) state = "partial";
      else state = cursor === day ? "started" : "missed";
    } else if (entry) {
      state = "done";
    }
    out.push({
      day: cursor,
      state,
      today: cursor === day,
      planned: progress ? progress.total : (entry ? entry.planned : 0),
      graded: progress ? progress.graded : (entry ? entry.graded : 0),
      accuracy: progress ? progress.accuracy : (entry ? entry.accuracy : null)
    });
  }
  return out;
}

/* --------------------------------------------------------------------------
   备份
   -------------------------------------------------------------------------- */

function exportPayload(store, atMs) {
  const base = asStore(store);
  return {
    version: STORE_VERSION,
    exportedAt: Number.isFinite(atMs) ? atMs : 0,
    notes: base.notes,
    plans: base.plans,
    history: base.history,
    settings: base.settings
  };
}

// 导入比本地读取严格：版本不认识就整份拒绝，坏条目单独丢掉。
// 选错文件时宁可什么都不做，也不要拿半份数据覆盖现有生词本。
function parseBackup(text) {
  if (typeof text !== "string" || text === "") {
    return { ok: false, error: "备份文件无法识别", store: null };
  }
  if (text.length > MAX_IMPORT_CHARS) {
    return { ok: false, error: "备份文件过大", store: null };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "备份文件无法识别", store: null };
  }
  const { store, error } = readStoreValue(value, { strict: true });
  if (error) return { ok: false, error, store: null };
  return { ok: true, error: "", store };
}

// 合并：只增不减。同一个词留复习得更深的那条；同一天的计划留完成得更晚的；
// 设置（每日词量）以本地为准。
function preferNote(local, incoming) {
  const a = reviewOf(local);
  const b = reviewOf(incoming);
  if (a.stage !== b.stage) return b.stage > a.stage ? incoming : local;
  if (a.lastAt !== b.lastAt) return b.lastAt > a.lastAt ? incoming : local;
  if (levelOf(incoming) !== levelOf(local)) return levelOf(incoming) > levelOf(local) ? incoming : local;
  return (incoming.at || 0) > (local.at || 0) ? incoming : local;
}

function preferPlan(local, incoming) {
  const a = local.finishedAt || 0;
  const b = incoming.finishedAt || 0;
  if (a !== b) return b > a ? incoming : local;
  return (incoming.results || []).length > (local.results || []).length ? incoming : local;
}

function mergeStores(local, imported) {
  const a = asStore(local);
  const b = asStore(imported);
  const byKey = new Map();
  for (const note of [...a.notes, ...b.notes]) {
    const cleaned = cleanNote(note);
    if (!cleaned) continue;
    const key = noteKey(cleaned.word);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing ? preferNote(existing, cleaned) : cleaned);
  }
  const notes = [...byKey.values()].sort((x, y) => (y.at || 0) - (x.at || 0));

  const plans = {};
  for (const key of Object.keys(a.plans)) {
    const plan = cleanPlan(a.plans[key], key);
    if (plan) plans[plan.day] = plan;
  }
  for (const key of Object.keys(b.plans)) {
    const plan = cleanPlan(b.plans[key], key);
    if (!plan) continue;
    const current = plans[plan.day];
    plans[plan.day] = current ? preferPlan(current, plan) : plan;
  }

  const history = dedupeHistory([...a.history, ...b.history]
    .map(cleanHistoryEntry).filter(Boolean));

  return pruneStore({
    version: STORE_VERSION,
    notes,
    plans,
    history,
    settings: a.settings
  }, todayDay());
}

export {
  DEFAULT_DAILY_COUNT,
  candidateSummary,
  buildPlanWords,
  ensurePlan,
  planProgress,
  resumeState,
  dailySessionNotes,
  applyGradeToStore,
  touchPlan,
  finishPlan,
  dailyStatus,
  streakOf,
  calendarDays,
  exportPayload,
  parseBackup,
  mergeStores,
  storeChars
};
