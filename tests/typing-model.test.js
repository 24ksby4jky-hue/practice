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
