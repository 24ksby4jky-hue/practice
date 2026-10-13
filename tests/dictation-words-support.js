const assert = require("node:assert/strict");
const { isDictationWord } = require("../dictation-model.js");

const POS_RE = /^(n|v|adj|adv|prep|conj|pron)\.$/;
const PHONETIC_RE = /^\/[^/]+\/$/;
const HAN_RE = /\p{Script=Han}/u;

function assertBoard(board, expected) {
  assert.equal(board.id, expected.id);
  assert.equal(board.name, expected.name);
  assert.equal(board.units.length, 25);

  const seen = new Set();
  board.units.forEach((unit, unitIndex) => {
    assert.equal(unit.words.length, 20, `unit ${unitIndex + 1} must have 20 words`);
    if (expected.sides) {
      assert.equal(unit.side, expected.sides[unitIndex], `unit ${unitIndex + 1} side`);
    } else {
      assert.equal(unit.side, undefined, `unit ${unitIndex + 1} must not have side`);
    }

    unit.words.forEach((entry) => {
      const label = `${entry.word} (unit ${unitIndex + 1})`;
      assert.equal(isDictationWord(entry.word), true, `${label} word shape`);
      assert.match(entry.pos, POS_RE, `${label} pos`);
      assert.match(entry.phonetic, PHONETIC_RE, `${label} phonetic`);
      assert.match(entry.meaning, HAN_RE, `${label} meaning`);
      assert.equal(
        entry.example.toLowerCase().includes(entry.word),
        true,
        `${label} example must contain the word`
      );
      assert.equal(seen.has(entry.word), false, `${label} is duplicated in the board`);
      seen.add(entry.word);
    });
  });
  assert.equal(seen.size, 500);
}

module.exports = { assertBoard };
