// 生词本的存储键。原来写死在 dictation.js:2，现在只有这一处定义 ——
// 改名字不会再悄悄把已经存下来的词丢掉。
const NOTE_KEY = "dictationNotebook:guest";

// 上限 40 条，和原来一致（原 dictation.js 的 slice(0, 40)）。
const NOTE_LIMIT = 40;

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

function isNote(item) {
  return Boolean(item) && typeof item === "object" && !Array.isArray(item)
    && typeof item.word === "string" && item.word !== ""
    && typeof item.meaning === "string";
}

function levelOf(note) {
  const value = note && note.level;
  return LEVEL_IDS.indexOf(value) === -1 ? 0 : value;
}

// 传进来的是 localStorage 里的原始字符串，不是解析过的值 ——
// 解析和形状校验是这个模块的职责，调用方不用各写一遍 try/catch。
function readNotes(raw) {
  if (typeof raw !== "string" || raw === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isNote);
}

// 最新的在前。同一个词已经记过就不动它 —— 连 at 也不刷新，
// 否则用户正在看列表的时候顺序会自己变。这是原来的行为，保持。
function addNote(list, entry, atMs) {
  const current = (Array.isArray(list) ? list : []).filter(isNote);
  if (!entry || typeof entry !== "object") return current;
  if (typeof entry.word !== "string" || entry.word === "") return current;
  if (current.some((item) => item.word === entry.word)) return current;
  const note = {
    word: entry.word,
    meaning: typeof entry.meaning === "string" ? entry.meaning : "",
    at: atMs
  };
  return [note, ...current].slice(0, NOTE_LIMIT);
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

// 存下来的只有 word / meaning / at / level，音标、词性、例句要现查。
// 查不到就标 missing —— 词表改过之后老词可能已经不在里面了，
// 但那是用户自己记的，不能默默删掉。
// sources 是可选的：不给就不往结果里塞 source，老调用方的形状不变。
function enrich(notes, lookup, sources) {
  const list = Array.isArray(notes) ? notes : [];
  const find = typeof lookup === "function" ? lookup : () => null;
  const where = sources && typeof sources === "object" ? sources : null;
  return list.map((note) => {
    const base = { word: note.word, meaning: note.meaning, at: note.at, level: levelOf(note) };
    if (where) base.source = where[note.word] || null;
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
  NOTE_KEY, NOTE_LIMIT, LEVELS, readNotes, levelOf, addNote, removeNote, clearNotes, setLevel,
  wordIndex, sourceIndex, enrich, filterNotes, countsByLevel, sortNotes
};
