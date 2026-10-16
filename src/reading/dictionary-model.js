const LETTER = /[a-zA-Z'’\-]/;

export function normalizeDictionaryKey(value) {
  if (typeof value !== "string") return "";
  const key = value.normalize("NFKC").replace(/[‘’]/g, "'").trim().toLowerCase().replace(/\s+/g, " ");
  return key.length <= 100 && /^[a-z][a-z '\-.]*[a-z.]$|^[a-z]$/.test(key) ? key : "";
}

// 与导入脚本共用分片算法。浏览器只取命中分片，不加载整本词典。
export function dictionaryShard(key) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0 & 255).toString(16).padStart(2, "0");
}

const IRREGULAR = {
  children: "child", people: "person", men: "man", women: "woman", feet: "foot", teeth: "tooth", mice: "mouse",
  went: "go", gone: "go", was: "be", were: "be", been: "be", am: "be", is: "be", are: "be",
  had: "have", has: "have", did: "do", does: "do", done: "do", saw: "see", seen: "see",
  thought: "think", bought: "buy", brought: "bring", taught: "teach", caught: "catch", knew: "know", known: "know",
  wrote: "write", written: "write", took: "take", taken: "take", gave: "give", given: "give", felt: "feel", found: "find",
  spoke: "speak", spoken: "speak", ate: "eat", eaten: "eat", ran: "run", better: "good", best: "good", worse: "bad", worst: "bad"
};

export function wordCandidates(value) {
  const word = normalizeDictionaryKey(value);
  if (!word) return [];
  const out = [word];
  const add = (candidate) => { if (candidate.length >= 2 && !out.includes(candidate)) out.push(candidate); };
  if (IRREGULAR[word]) add(IRREGULAR[word]);
  if (word.endsWith("'s")) for (const candidate of wordCandidates(word.slice(0, -2))) add(candidate);
  if (word.endsWith("ies")) add(word.slice(0, -3) + "y");
  if (word.endsWith("ied")) add(word.slice(0, -3) + "y");
  if (word.endsWith("s") && !word.endsWith("ss")) { add(word.slice(0, -1)); if (word.endsWith("es")) add(word.slice(0, -2)); }
  for (const suffix of ["ing", "ed", "er", "est"]) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 2) continue;
    const stem = word.slice(0, -suffix.length);
    add(stem); add(stem + "e");
    if (/(\w)\1$/.test(stem)) add(stem.slice(0, -1));
    if (stem.endsWith("i")) add(stem.slice(0, -1) + "y");
  }
  return out;
}

export function wordBounds(text, offset) {
  if (typeof text !== "string" || !Number.isInteger(offset) || offset < 0 || offset > text.length) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && LETTER.test(text[start - 1])) start -= 1;
  while (end < text.length && LETTER.test(text[end])) end += 1;
  const raw = text.slice(start, end).replace(/^['’\-]+|['’\-]+$/g, "");
  const word = normalizeDictionaryKey(raw);
  if (!word) return null;
  start += text.slice(start, end).indexOf(raw);
  return { word, start, end: start + raw.length };
}
