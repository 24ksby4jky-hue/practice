const DICTATION_WORD_RE = /^[a-z]+(?:['-][a-z]+)*$/;

const BOARDS = [
  { id: "campus", name: "校园生活" },
  { id: "academic-writing", name: "学术写作" },
  { id: "charts", name: "图表描述" },
  { id: "daily-life", name: "日常生活" },
  { id: "city-travel", name: "城市与出行" },
  { id: "work", name: "工作与职业" },
  { id: "health-environment", name: "健康与环境" },
  { id: "tech-society", name: "科技与社会" }
];

const DICTATION_SUBTITLE = "听发音，把单词拼进空格。错字母会标红。看答案这一词算错。";

function isDictationWord(word) {
  return DICTATION_WORD_RE.test(word);
}

function shouldMarkUnitDone({ kind, resultCount }) {
  return kind === "unit" && resultCount === 20;
}

function unitKey(unitNumber) {
  return String(unitNumber);
}

function isValidUnitKey(key) {
  const n = Number(key);
  return Number.isInteger(n) && n >= 1 && n <= 25 && unitKey(n) === key;
}

function readUnitDone(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out = {};
  for (const boardId of Object.keys(raw)) {
    const board = raw[boardId];
    if (!board || typeof board !== "object" || Array.isArray(board)) continue;
    const units = {};
    for (const key of Object.keys(board)) {
      if (board[key] === true && isValidUnitKey(key)) {
        units[key] = true;
      }
    }
    if (Object.keys(units).length) {
      out[boardId] = units;
    }
  }
  return out;
}

function markUnitDone(store, boardId, unitNumber) {
  const key = unitKey(unitNumber);
  const base = readUnitDone(store);
  const board = base[boardId] || {};
  if (board[key] === true) {
    return base;
  }
  return {
    ...base,
    [boardId]: { ...board, [key]: true }
  };
}

function isUnitDone(store, boardId, unitNumber) {
  const normalized = readUnitDone(store);
  const board = normalized[boardId];
  if (!board) return false;
  return board[unitKey(unitNumber)] === true;
}

function unitRange(unitNumber) {
  const start = (unitNumber - 1) * 20 + 1;
  const end = unitNumber * 20;
  return { start, end };
}

function progressLabel({ review, index, total, boardName, unitNumber, source }) {
  const current = Math.min(index + 1, total);
  if (source) {
    const label = review ? "复习" : "听写";
    return `${label} ${current} / ${total} · ${source}`;
  }
  const label = review ? "复习" : "练习";
  return `${label} ${current} / ${total} · ${boardName} · 第 ${unitNumber} 组`;
}

// 「2026-10-17」→「2026年10月17日的生词」。日期不合法就退回一个还能读的名字。
function notebookDayLabel(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof day === "string" ? day : "");
  if (!match) return "当日生词";
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日的生词`;
}

// 「2026-10-17」→「每日生词 · 10月17日」。每日听写的来源标签 ——
// 进度条上不写年份，年份在计划卡片上已经有了。
function dailySourceLabel(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof day === "string" ? day : "");
  if (!match) return "每日生词";
  return `每日生词 · ${Number(match[2])}月${Number(match[3])}日`;
}

// 生词本当日听写能拼的词。大写收成小写；词组、缩写和重复的留下不进这一轮。
function notebookSessionWords(notes) {
  const list = Array.isArray(notes) ? notes : [];
  const seen = new Set();
  const words = [];
  for (const note of list) {
    if (!note || typeof note.word !== "string") continue;
    const word = note.word.trim().toLowerCase();
    if (!isDictationWord(word) || seen.has(word)) continue;
    seen.add(word);
    words.push({
      word,
      meaning: typeof note.meaning === "string" ? note.meaning : "",
      phonetic: typeof note.phonetic === "string" ? note.phonetic : "",
      pos: typeof note.pos === "string" ? note.pos : "",
      example: typeof note.example === "string" ? note.example : ""
    });
  }
  return words;
}

function enterDictation() {
  return { screen: "picker", boardId: "campus" };
}

function selectBoard(boardId) {
  return { screen: "picker", boardId };
}

function startUnit(boardId, unitNumber) {
  return { screen: "session", boardId, unitNumber, kind: "unit", wordIndex: 0 };
}

function startReview(boardId, unitNumber) {
  return { screen: "session", boardId, unitNumber, kind: "review", wordIndex: 0 };
}

function returnToUnits(boardId) {
  return { screen: "picker", boardId };
}

function sessionOutcome(session, resultCount) {
  return {
    mark: shouldMarkUnitDone({ kind: session.kind, resultCount }),
    screen: "report",
    boardId: session.boardId,
    unitNumber: session.unitNumber
  };
}

function unitDoneKey() {
  return "dictationUnitDone:guest";
}

export {
  BOARDS,
  DICTATION_SUBTITLE,
  isDictationWord,
  shouldMarkUnitDone,
  readUnitDone,
  markUnitDone,
  isUnitDone,
  unitRange,
  progressLabel,
  notebookDayLabel,
  dailySourceLabel,
  notebookSessionWords,
  enterDictation,
  selectBoard,
  startUnit,
  startReview,
  returnToUnits,
  sessionOutcome,
  unitDoneKey
};
