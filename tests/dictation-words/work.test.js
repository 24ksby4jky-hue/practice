const test = require("node:test");
const board = require("../../dictation/words/work.js");
const { assertBoard } = require("../dictation-words-support.js");

test("work board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "work", name: "工作与职业" });
});
