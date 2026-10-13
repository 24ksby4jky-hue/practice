const test = require("node:test");
const board = require("../../dictation/words/daily-life.js");
const { assertBoard } = require("../dictation-words-support.js");

test("daily-life board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "daily-life", name: "日常生活" });
});
