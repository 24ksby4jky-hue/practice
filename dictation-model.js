(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DictationModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
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

  function progressLabel({ review, index, total, boardName, unitNumber }) {
    const label = review ? "复习" : "练习";
    const current = Math.min(index + 1, total);
    return `${label} ${current} / ${total} · ${boardName} · 第 ${unitNumber} 组`;
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

  return {
    BOARDS,
    DICTATION_SUBTITLE,
    isDictationWord,
    shouldMarkUnitDone,
    readUnitDone,
    markUnitDone,
    isUnitDone,
    unitRange,
    progressLabel,
    enterDictation,
    selectBoard,
    startUnit,
    startReview,
    returnToUnits,
    sessionOutcome,
    unitDoneKey
  };
});
