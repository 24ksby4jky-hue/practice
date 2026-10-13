const test = require("node:test");
const board = require("../../dictation/words/city-travel.js");
const { assertBoard } = require("../dictation-words-support.js");

test("city-travel board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "city-travel", name: "城市与出行" });
});
