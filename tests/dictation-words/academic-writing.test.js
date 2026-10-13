const test = require("node:test");
const assert = require("node:assert/strict");
const board = require("../../dictation/words/academic-writing.js");
const campus = require("../../dictation/words/campus.js");
const { assertBoard } = require("../dictation-words-support.js");

test("academic-writing board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "academic-writing", name: "学术写作" });
});

test("academic-writing unit 1 keeps the original six words in order", () => {
  assert.deepEqual(board.units[0].words.slice(0, 6), [
    { word: "analyze", pos: "v.", phonetic: "/ˈænəlaɪz/", meaning: "分析", example: "Analyze the results before you draw a conclusion." },
    { word: "evidence", pos: "n.", phonetic: "/ˈevɪdəns/", meaning: "证据", example: "The essay needs evidence from more than one source." },
    { word: "contrast", pos: "n.", phonetic: "/ˈkɒntrɑːst/", meaning: "对比", example: "The contrast between the two cities is sharp." },
    { word: "significant", pos: "adj.", phonetic: "/sɪɡˈnɪfɪkənt/", meaning: "显著的", example: "There was a significant rise in bicycle trips." },
    { word: "approach", pos: "n.", phonetic: "/əˈprəʊtʃ/", meaning: "方法", example: "A slower approach produced fewer spelling errors." },
    { word: "conclusion", pos: "n.", phonetic: "/kənˈkluːʒn/", meaning: "结论", example: "The conclusion should answer the question directly." }
  ]);
});

test("academic-writing does not reuse campus words and leaves out increase", () => {
  const campusWords = new Set(
    campus.units.flatMap((unit) => unit.words.map((entry) => entry.word.toLowerCase()))
  );
  const words = board.units.flatMap((unit) => unit.words.map((entry) => entry.word.toLowerCase()));
  assert.deepEqual(words.filter((word) => campusWords.has(word)), []);
  assert.equal(words.includes("increase"), false);
});
