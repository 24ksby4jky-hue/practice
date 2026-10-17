import { isDictationWord } from "./dictation/dictation-model.js";

// 生词本的存储键。原来写死在 dictation.js:2，现在只有这一处定义 ——
// 改名字不会再悄悄把已经存下来的词丢掉。
const NOTE_KEY = "dictationNotebook:guest";

// 存储结构版本。v1 是裸数组；v2 是 { version, notes, plans, history, settings }。
// 读的时候两种都认（看见数组就当 v1），写的时候一律写 v2 —— 旧数据在下一次
// 写入时自然升级，不需要单独的迁移步骤。
const STORE_VERSION = 2;

// 每日听写的词量。这是每天的计划规模，不是存储上限。
const DEFAULT_DAILY_COUNT = 20;
const DAILY_COUNT_MIN = 5;
const DAILY_COUNT_MAX = 60;

// 计划只留最近 90 天，历史每天一条、留 200 天。
const PLAN_RETENTION_DAYS = 90;
const HISTORY_LIMIT = 200;

// 导入时的硬上限。超过这个量级的「备份」基本是选错了文件。
const MAX_IMPORT_NOTES = 10000;
const MAX_IMPORT_CHARS = 8000000;

// 序列化后超过这个长度就提示用户导出备份。浏览器配额约 5MB（UTF-16 字符数），
// 留出一半余量：写不进去比写进去要糟得多。
const SOFT_SIZE_CHARS = 1200000;

// 掌握程度。参照欧路词典生词本里那个「星级」：一个生词本光有词、没有状态，
// 攒到上限就只会越看越乱 —— 标了状态才分得清哪些已经不用再看了。
//   0 没记住（默认）· 1 在记 · 2 记住了
//
// 默认那档刻意**不落盘**：刚答错收进来的词没有 level 字段，levelOf 当 0 读。
// 这样老记录的形状一个字都不用改。
const LEVELS = [
  { id: 0, name: "没记住" },
  { id: 1, name: "在记" },
  { id: 2, name: "记住了" }
];

const LEVEL_IDS = LEVELS.map((item) => item.id);

// 间隔复习：档位 = 数组下标。答对升一档，下次复习日 = 今天 + 新档位的间隔。
// 答错退回 0 档、明天再来。0 档的 0 天只在「刚收进来」时用到，答对后
// 升到 1 档就是明天，所以永远不会出现 dueDay = 今天 的死循环。
const REVIEW_INTERVALS = [0, 1, 3, 7, 15, 30];
const REVIEW_MAX_STAGE = 5;

function isNote(item) {
  return Boolean(item) && typeof item === "object" && !Array.isArray(item)
    && typeof item.word === "string" && item.word !== ""
    && typeof item.meaning === "string";
}

function levelOf(note) {
  const value = note && note.level;
  return LEVEL_IDS.indexOf(value) === -1 ? 0 : value;
}

function noteKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readingSource(source) {
  if (!source || source.type !== "reading" || typeof source.title !== "string") return null;
  return { type: "reading", title: source.title.slice(0, 300),
    query: typeof source.query === "string" ? source.query.slice(0, 100) : "" };
}

/* --------------------------------------------------------------------------
   日期
   -------------------------------------------------------------------------- */

// 加入时间落在本地日历的哪一天。坏时间戳给空串，调用方筛不中它。
function dayOf(at) {
  if (typeof at !== "number" || !Number.isFinite(at)) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isCalendarDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, month - 1, date);
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === date;
}

function todayDay(nowMs) {
  return dayOf(typeof nowMs === "number" ? nowMs : Date.now());
}

// 日子加减天数。用本地中午算，夏令时切换那天也不会跳到前一天/后一天。
function addDays(day, n) {
  if (!isCalendarDay(day) || !Number.isFinite(n)) return "";
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, month - 1, date + Math.trunc(n), 12, 0, 0, 0);
  return dayOf(value.getTime());
}

/* --------------------------------------------------------------------------
   复习调度
   -------------------------------------------------------------------------- */

function countOf(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

// 一条记录该读成什么复习状态。没有 review 的老记录按「加入当天到期」算：
// 这样升级之后，之前攒下的词会直接进入第一轮复习，而不是被当成新词跳过。
function reviewOf(note) {
  const raw = note && note.review;
  const baseDay = dayOf(note && note.at);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { stage: 0, dueDay: baseDay, lastAt: 0, correct: 0, wrong: 0 };
  }
  const stage = Number.isInteger(raw.stage) && raw.stage >= 0 && raw.stage <= REVIEW_MAX_STAGE
    ? raw.stage : 0;
  let dueDay = baseDay;
  if (raw.dueDay === "") dueDay = "";
  else if (isCalendarDay(raw.dueDay)) dueDay = raw.dueDay;
  return {
    stage,
    dueDay,
    lastAt: Number.isFinite(raw.lastAt) && raw.lastAt > 0 ? raw.lastAt : 0,
    correct: countOf(raw.correct),
    wrong: countOf(raw.wrong)
  };
}

function cleanReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stage = Number.isInteger(value.stage) && value.stage >= 0 && value.stage <= REVIEW_MAX_STAGE
    ? value.stage : 0;
  const dueDay = value.dueDay === "" || isCalendarDay(value.dueDay) ? value.dueDay : "";
  return {
    stage,
    dueDay,
    lastAt: Number.isFinite(value.lastAt) && value.lastAt > 0 ? value.lastAt : 0,
    correct: countOf(value.correct),
    wrong: countOf(value.wrong)
  };
}

// 一次听写结果写回一条记录。advance=false 只累加对错次数、不动档位 ——
// 「复习错词」那一轮就是这样，避免同一个词一天里被推进两次。
function gradeNote(note, correct, day, atMs, options = {}) {
  if (!isNote(note)) return note;
  const advance = options.advance !== false;
  const current = reviewOf(note);
  const hit = correct === true;
  const next = {
    stage: current.stage,
    dueDay: current.dueDay,
    lastAt: Number.isFinite(atMs) ? atMs : 0,
    correct: current.correct + (hit ? 1 : 0),
    wrong: current.wrong + (hit ? 0 : 1)
  };
  if (advance) {
    if (hit) {
      next.stage = Math.min(current.stage + 1, REVIEW_MAX_STAGE);
      next.dueDay = addDays(day, REVIEW_INTERVALS[next.stage]);
    } else {
      next.stage = 0;
      next.dueDay = addDays(day, 1);
    }
  }
  return { ...note, review: next };
}

// 同一个词可能在老数据里大小写重复（阅读收藏存的是原形，听写存的是小写），
// 按小写词形一次全改，别留一条跟不上进度的。
function gradeNotes(notes, word, correct, day, atMs, options = {}) {
  const list = Array.isArray(notes) ? notes : [];
  const key = noteKey(word);
  if (!key) return list;
  let changed = false;
  const next = list.map((note) => {
    if (!isNote(note) || noteKey(note.word) !== key) return note;
    changed = true;
    return gradeNote(note, correct, day, atMs, options);
  });
  return changed ? next : list;
}

/* --------------------------------------------------------------------------
   清洗
   -------------------------------------------------------------------------- */

function cleanNote(value) {
  if (!isNote(value)) return null;
  const note = {
    word: value.word,
    meaning: value.meaning,
    at: Number.isFinite(value.at) ? value.at : 0
  };
  const source = readingSource(value.source);
  if (source) note.source = source;
  if (LEVEL_IDS.indexOf(value.level) !== -1) note.level = value.level;
  const review = cleanReview(value.review);
  if (review) note.review = review;
  return note;
}

function clampDailyCount(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_DAILY_COUNT;
  return Math.min(DAILY_COUNT_MAX, Math.max(DAILY_COUNT_MIN, number));
}

// 计划里的词只存小写词串；释义、音标、例句在开始听写时现补 ——
// 计划是「今天听哪些词」，不是词典副本。
function cleanPlan(value, dayKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const day = isCalendarDay(dayKey) ? dayKey : (isCalendarDay(value.day) ? value.day : "");
  if (!day) return null;
  const seen = new Set();
  const words = [];
  for (const item of Array.isArray(value.words) ? value.words : []) {
    const word = noteKey(item);
    if (!isDictationWord(word) || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  // 结果必须是词表的连续前缀：results.length 就是续听下标，
  // 错位一条就会把后面的词全跳过去。
  if (!words.length) return null;
  const rawResults = Array.isArray(value.results) ? value.results : [];
  const results = [];
  for (let i = 0; i < rawResults.length && i < words.length; i += 1) {
    const item = rawResults[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) break;
    if (noteKey(item.word) !== words[i]) break;
    results.push({
      word: words[i],
      correct: item.correct === true,
      at: Number.isFinite(item.at) ? item.at : 0
    });
  }
  return {
    day,
    words,
    results,
    startedAt: Number.isFinite(value.startedAt) ? value.startedAt : 0,
    finishedAt: Number.isFinite(value.finishedAt) ? value.finishedAt : null,
    elapsedSeconds: Math.max(0, Math.floor(Number(value.elapsedSeconds) || 0)),
    dailyCount: clampDailyCount(value.dailyCount),
    builtAt: Number.isFinite(value.builtAt) ? value.builtAt : 0
  };
}

function cleanHistoryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!isCalendarDay(value.day)) return null;
  const planned = Math.max(0, Math.floor(Number(value.planned) || 0));
  const graded = Math.max(0, Math.floor(Number(value.graded) || 0));
  const correct = Math.min(graded, Math.max(0, Math.floor(Number(value.correct) || 0)));
  const seen = new Set();
  const missed = [];
  for (const item of Array.isArray(value.missed) ? value.missed : []) {
    const word = noteKey(item);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    missed.push(word);
  }
  return {
    day: value.day,
    finishedAt: Number.isFinite(value.finishedAt) ? value.finishedAt : 0,
    planned,
    graded,
    correct,
    accuracy: graded ? Math.round((correct / graded) * 100) : 0,
    elapsedSeconds: Math.max(0, Math.floor(Number(value.elapsedSeconds) || 0)),
    missed
  };
}

/* --------------------------------------------------------------------------
   存储结构
   -------------------------------------------------------------------------- */

function emptyStore() {
  return {
    version: STORE_VERSION,
    notes: [],
    plans: {},
    history: [],
    settings: { dailyCount: DEFAULT_DAILY_COUNT }
  };
}

function cleanSettings(value) {
  return { dailyCount: clampDailyCount(value && value.dailyCount) };
}

function dedupeHistory(entries) {
  const byDay = new Map();
  for (const entry of entries) {
    const current = byDay.get(entry.day);
    if (!current || entry.finishedAt >= current.finishedAt) byDay.set(entry.day, entry);
  }
  return [...byDay.values()]
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, HISTORY_LIMIT);
}

// 把解析好的值读成 store。strict 给导入用：版本更旧/更新的整份备份都拒掉，
// 而不是默默当成空库 —— 导入时「什么都没发生」比「悄悄覆盖」好。
function readStoreValue(value, options = {}) {
  const strict = options.strict === true;
  if (Array.isArray(value)) {
    if (value.length > MAX_IMPORT_NOTES) {
      return { store: emptyStore(), error: "备份里的生词过多" };
    }
    const notes = value.map(cleanNote).filter(Boolean);
    return { store: { ...emptyStore(), notes }, error: "" };
  }
  if (!value || typeof value !== "object") return { store: emptyStore(), error: "" };
  const version = Number.isFinite(value.version) ? value.version : 0;
  if (version > STORE_VERSION) return { store: emptyStore(), error: "备份来自更新版本" };
  if (strict && version !== STORE_VERSION) {
    return { store: emptyStore(), error: "备份版本无法识别" };
  }
  const rawNotes = Array.isArray(value.notes) ? value.notes : [];
  if (rawNotes.length > MAX_IMPORT_NOTES) {
    return { store: emptyStore(), error: "备份里的生词过多" };
  }
  const notes = rawNotes.map(cleanNote).filter(Boolean);

  const plans = {};
  const rawPlans = value.plans && typeof value.plans === "object" && !Array.isArray(value.plans)
    ? value.plans : {};
  for (const key of Object.keys(rawPlans)) {
    const plan = cleanPlan(rawPlans[key], key);
    if (plan) plans[plan.day] = plan;
  }

  const history = dedupeHistory((Array.isArray(value.history) ? value.history : [])
    .map(cleanHistoryEntry).filter(Boolean));

  return {
    store: {
      version: STORE_VERSION,
      notes,
      plans,
      history,
      settings: cleanSettings(value.settings)
    },
    error: ""
  };
}

function readStore(raw, options = {}) {
  if (typeof raw !== "string" || raw === "") return emptyStore();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyStore();
  }
  return readStoreValue(parsed, options).store;
}

// 传进来的是 localStorage 里的原始字符串，不是解析过的值 ——
// 解析和形状校验是这个模块的职责，调用方不用各写一遍 try/catch。
function readNotes(raw) {
  return readStore(raw).notes;
}

function storeChars(store) {
  try {
    return JSON.stringify(store).length;
  } catch {
    return 0;
  }
}

function withNotes(store, notes) {
  return { ...store, version: STORE_VERSION, notes };
}

/* --------------------------------------------------------------------------
   生词操作（纯函数，返回新的 store）
   -------------------------------------------------------------------------- */

// 最新的在前。同一个词已经记过就不动它 —— 连 at 也不刷新，
// 否则用户正在看列表的时候顺序会自己变。这是原来的行为，保持。
// 不再截断：以前 slice(0, 40)，第 41 个词会把最老的那个静默挤掉。
function addNote(list, entry, atMs) {
  const current = (Array.isArray(list) ? list : []).filter(isNote);
  if (!entry || typeof entry !== "object") return current;
  if (typeof entry.word !== "string" || entry.word === "") return current;
  if (current.some((item) => item.word.toLowerCase() === entry.word.trim().toLowerCase())) return current;
  const note = {
    word: entry.word,
    meaning: typeof entry.meaning === "string" ? entry.meaning : "",
    at: atMs
  };
  const source = readingSource(entry.source);
  if (source) note.source = source;
  return [note, ...current];
}

function removeNote(list, word) {
  return (Array.isArray(list) ? list : []).filter((item) => item.word !== word);
}

function clearNotes() {
  return [];
}

// 改一个词的掌握程度。认不出来的档位原样返回，不写脏数据进去。
function setLevel(list, word, level) {
  const current = (Array.isArray(list) ? list : []).filter(isNote);
  if (LEVEL_IDS.indexOf(level) === -1) return current;
  return current.map((item) => (item.word === word ? { ...item, level } : item));
}

function addNoteToStore(store, entry, atMs) {
  return withNotes(store, addNote(store.notes, entry, atMs));
}

function setLevelInStore(store, word, level) {
  return withNotes(store, setLevel(store.notes, word, level));
}

function removeNoteFromStore(store, word) {
  return withNotes(store, removeNote(store.notes, word));
}

function clearNotesInStore(store) {
  return {
    ...store,
    version: STORE_VERSION,
    notes: [],
    plans: {},
    history: []
  };
}

function setDailyCount(store, value) {
  return {
    ...store,
    version: STORE_VERSION,
    settings: { ...store.settings, dailyCount: clampDailyCount(value) }
  };
}

// 计划只留最近 90 天。skip 掉更早的，避免存储越攒越慢 ——
// 每次落盘都要把整份 store 重新序列化一遍。
function pruneStore(store, today) {
  const base = store && typeof store === "object" ? store : emptyStore();
  const day = isCalendarDay(today) ? today : todayDay();
  const oldest = addDays(day, -PLAN_RETENTION_DAYS);
  const plans = {};
  for (const key of Object.keys(base.plans || {})) {
    const plan = base.plans[key];
    if (!plan || !isCalendarDay(plan.day)) continue;
    if (oldest && plan.day < oldest) continue;
    if (plan.day > day) continue;
    plans[plan.day] = plan;
  }
  return {
    ...base,
    version: STORE_VERSION,
    notes: Array.isArray(base.notes) ? base.notes.filter(isNote) : [],
    plans,
    history: dedupeHistory(Array.isArray(base.history) ? base.history : []),
    settings: cleanSettings(base.settings)
  };
}

/* --------------------------------------------------------------------------
   生词本里的词表索引
   -------------------------------------------------------------------------- */

// 把 8 个板块、200 个单元的 4000 个词摊平成 word → 词条 的表，
// 这样补音标和例句是查一次而不是扫一遍。重词以最后一个为准。
function wordIndex(boards) {
  const index = {};
  const list = Array.isArray(boards) ? boards : [];
  for (const board of list) {
    const units = board && Array.isArray(board.units) ? board.units : [];
    for (const unit of units) {
      const words = unit && Array.isArray(unit.words) ? unit.words : [];
      for (const entry of words) {
        if (entry && typeof entry.word === "string") index[entry.word] = entry;
      }
    }
  }
  return index;
}

// 这个词是从哪个板块、哪个单元来的。参照欧路词典生词本的「来源」。
//
// 现查，不在收词的时候另存一份 —— 词表改了来源跟着改，不会留一份过期的。
// 单元没有编号字段，序号就是数组下标 + 1（dictation.js 取词也是这么算的）。
function sourceIndex(boards) {
  const index = {};
  const list = Array.isArray(boards) ? boards : [];
  for (const board of list) {
    const units = board && Array.isArray(board.units) ? board.units : [];
    units.forEach((unit, position) => {
      const words = unit && Array.isArray(unit.words) ? unit.words : [];
      for (const entry of words) {
        if (!entry || typeof entry.word !== "string") continue;
        index[entry.word] = {
          boardId: board.id || "",
          boardName: board.name || "",
          unit: position + 1
        };
      }
    });
  }
  return index;
}

// 保存 word / meaning / at / level，阅读收藏额外记下书名与原词；完整词典注释现查。
// 查不到就标 missing —— 词表改过之后老词可能已经不在里面了，
// 但那是用户自己记的，不能默默删掉。
// sources 是可选的：不给就不往结果里塞 source，老调用方的形状不变。
function enrich(notes, lookup, sources) {
  const list = Array.isArray(notes) ? notes : [];
  const find = typeof lookup === "function" ? lookup : () => null;
  const where = sources && typeof sources === "object" ? sources : null;
  return list.map((note) => {
    const base = { word: note.word, meaning: note.meaning, at: note.at, level: levelOf(note) };
    const source = readingSource(note.source);
    if (source || where) base.source = source || where[note.word] || null;
    const found = find(note.word);
    if (!found) return { ...base, missing: true };
    return {
      ...base,
      // 存下来的释义优先：生词本要显示用户当时看到的那一条
      pos: found.pos,
      phonetic: found.phonetic,
      example: found.example,
      missing: false
    };
  });
}

// 某一天加入的全部生词。不看掌握程度，也不看搜索 —— 那是列表的事。
// 顺序跟传进来的一样，不另排。
function notesOnDay(notes, day) {
  if (!isCalendarDay(day)) return [];
  const list = Array.isArray(notes) ? notes : [];
  return list.filter((note) => dayOf(note && note.at) === day);
}

// 筛选。level 传 "all" 或 0/1/2，query 是子串（词和释义都算命中）。
function filterNotes(notes, level, query) {
  const list = Array.isArray(notes) ? notes : [];
  const want = level === undefined || level === null ? "all" : level;
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  return list.filter((note) => {
    if (want !== "all" && levelOf(note) !== want) return false;
    if (!needle) return true;
    return `${note.word || ""} ${note.meaning || ""}`.toLowerCase().includes(needle);
  });
}

// 每一档各有多少词。界面上「全部 12 · 没记住 5 · 在记 4 · 记住了 3」
// 和「还剩多少要看」都从这儿来。
function countsByLevel(notes) {
  const list = Array.isArray(notes) ? notes : [];
  const counts = { all: list.length };
  for (const item of LEVELS) counts[item.id] = 0;
  for (const note of list) counts[levelOf(note)] += 1;
  return counts;
}

// 排序。默认按加入时间（新的在前，和存储顺序一致）。
// 按掌握程度排是为了把「已经记住的」沉到底下，上面留着的都是还要看的。
function sortNotes(notes, by) {
  const list = Array.isArray(notes) ? notes : [];
  if (by === "level") {
    return [...list].sort((a, b) => levelOf(a) - levelOf(b) || (b.at || 0) - (a.at || 0));
  }
  return [...list].sort((a, b) => (b.at || 0) - (a.at || 0));
}

export {
  NOTE_KEY, STORE_VERSION, LEVELS, DEFAULT_DAILY_COUNT, DAILY_COUNT_MIN, DAILY_COUNT_MAX,
  PLAN_RETENTION_DAYS, HISTORY_LIMIT, MAX_IMPORT_NOTES, MAX_IMPORT_CHARS, SOFT_SIZE_CHARS,
  REVIEW_INTERVALS, REVIEW_MAX_STAGE,
  readNotes, readStore, readStoreValue, emptyStore, cleanNote, cleanReview, cleanPlan,
  cleanHistoryEntry, clampDailyCount, noteKey, storeChars, pruneStore, dedupeHistory,
  levelOf, addNote, removeNote, clearNotes, setLevel,
  addNoteToStore, setLevelInStore, removeNoteFromStore, clearNotesInStore, setDailyCount,
  reviewOf, gradeNote, gradeNotes,
  wordIndex, sourceIndex, enrich, dayOf, todayDay, addDays, isCalendarDay, notesOnDay,
  filterNotes, countsByLevel, sortNotes
};
