import test from "node:test";
import assert from "node:assert/strict";
import { BOARDS } from "../src/dictation/dictation-model.js";
import boards from "../src/dictation/words/index.js";

// 断言的是应用真正在用的那份顺序（words/index.js），不是在测试里再抄一遍 ——
// 抄一份的话两边同时改错就测不出来了。
test("eight boards match BOARDS and do not repeat a word", () => {
  assert.equal(boards.length, 8);
  const words = [];
  boards.forEach((board, index) => {
    assert.equal(board.id, BOARDS[index].id);
    assert.equal(board.name, BOARDS[index].name);
    for (const unit of board.units) {
      for (const entry of unit.words) words.push(entry.word.toLowerCase());
    }
  });
  assert.equal(new Set(words).size, 4000);
  assert.equal(words.length, 4000);
});
