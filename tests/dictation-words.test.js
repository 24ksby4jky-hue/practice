const test = require("node:test");
const assert = require("node:assert/strict");
const { BOARDS } = require("../dictation-model.js");

test("eight boards match BOARDS and do not repeat a word", () => {
  const boards = BOARDS.map((item) => require(`../dictation/words/${item.id}.js`));
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
