const test = require("node:test");
const board = require("../../dictation/words/health-environment.js");
const { assertBoard } = require("../dictation-words-support.js");

test("health-environment board has 25 units of 20 valid words", () => {
  const sides = Array.from({ length: 25 }, (_, i) => (i < 12 ? "health" : "environment"));
  assertBoard(board, { id: "health-environment", name: "健康与环境", sides });
});
