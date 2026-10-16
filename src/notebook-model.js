// 生词本的存储键。原来写死在 dictation.js:2，现在只有这一处定义 ——
// 改名字不会再悄悄把已经存下来的词丢掉。
const NOTE_KEY = "dictationNotebook:guest";

// 上限 40 条，和原来一致（原 dictation.js 的 slice(0, 40)）。
const NOTE_LIMIT = 40;

function isNote(item) {
  return Boolean(item) && typeof item === "object" && !Array.isArray(item)
    && typeof item.word === "string" && item.word !== ""
    && typeof item.meaning === "string";
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

// 存下来的只有 word / meaning / at，音标、词性、例句要现查。
// 查不到就标 missing —— 词表改过之后老词可能已经不在里面了，
// 但那是用户自己记的，不能默默删掉。
function enrich(notes, lookup) {
  const list = Array.isArray(notes) ? notes : [];
  const find = typeof lookup === "function" ? lookup : () => null;
  return list.map((note) => {
    const found = find(note.word);
    if (!found) return { word: note.word, meaning: note.meaning, at: note.at, missing: true };
    return {
      word: note.word,
      // 存下来的释义优先：生词本要显示用户当时看到的那一条
      meaning: note.meaning,
      at: note.at,
      pos: found.pos,
      phonetic: found.phonetic,
      example: found.example,
      missing: false
    };
  });
}

export { NOTE_KEY, NOTE_LIMIT, readNotes, addNote, removeNote, clearNotes, wordIndex, enrich };
