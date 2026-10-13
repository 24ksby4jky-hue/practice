const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../typing-model.js");

function charsOf(text, maxChars) {
  return model.layout(text, maxChars).chars.map((item) => item.char).join("");
}

test("long word stays on one line", () => {
  const built = model.layout("Supercalifragilistic", 8);
  assert.equal(built.lines.length, 1);
  assert.equal(charsOf("Supercalifragilistic", 8), "Supercalifragilistic ");
});

test("blank lines are dropped and words are separated by one space", () => {
  assert.equal(charsOf("Alpha\n\n\nBeta\n", 40), "Alpha\nBeta ");
});

test("a non-final paragraph ends with a newline", () => {
  assert.equal(charsOf("one two\nthree", 80), "one two\nthree ");
});

test("curly quotes become straight quotes", () => {
  assert.equal(charsOf("it\u2019s \u201Cfine\u201D", 40), "it's \"fine\" ");
});

test("wpm is zero when no time or no words have elapsed", () => {
  assert.equal(model.wpm("hello world", 0), 0);
  assert.equal(model.wpm("", 60), 0);
});

test("wpm counts whitespace-separated words per minute", () => {
  assert.equal(model.wpm("hello world", 60), 2);
  assert.equal(model.wpm("hello world", 30), 4);
  assert.equal(model.wpm("hello", 1), 60);
});

test("a zero-second sample does not change saved wpm", () => {
  const next = model.applyPracticeStat(null, { wpm: 60, accuracy: 80, elapsedSecond: 0 });
  assert.deepEqual(next, {
    practiceCount: 1,
    bestWpm: 0,
    wpmSum: 0,
    wpmSamples: 0,
    bestAccuracy: 80,
    accuracySum: 80
  });
  assert.equal(model.averageWpm(next), 0);
});

test("a one-second sample updates the wpm average", () => {
  const first = model.applyPracticeStat(null, { wpm: 60, accuracy: 80, elapsedSecond: 0 });
  const next = model.applyPracticeStat(first, { wpm: 10, accuracy: 90, elapsedSecond: 60 });
  assert.equal(next.practiceCount, 2);
  assert.equal(next.bestWpm, 10);
  assert.equal(next.wpmSum, 10);
  assert.equal(next.wpmSamples, 1);
  assert.equal(next.bestAccuracy, 90);
  assert.equal(next.accuracySum, 170);
  assert.equal(model.averageWpm(next), 10);
});
