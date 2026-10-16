import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDictionaryKey, dictionaryShard, wordCandidates, wordBounds } from "../src/reading/dictionary-model.js";

test("查词键大小写、弯引号和空格统一，拒绝路径、脚本和非英文输入", () => {
  assert.equal(normalizeDictionaryKey(" Children's "), "children's");
  assert.equal(normalizeDictionaryKey("Mother’s"), "mother's");
  assert.equal(normalizeDictionaryKey("in   fact"), "in fact");
  for (const value of [null, "", "../../secret", "<script>", "42", "中文", "a".repeat(101)]) assert.equal(normalizeDictionaryKey(value), "");
});

test("分片算法稳定且落在 256 个分片以内", () => {
  assert.equal(dictionaryShard("read"), dictionaryShard("read"));
  for (const word of ["read", "book", "a", "child", "in fact"]) assert.match(dictionaryShard(word), /^[0-9a-f]{2}$/);
});

test("优先原词，兼顾常见复数、时态、双写和所有格", () => {
  for (const [input, expected] of [["books", "book"], ["reading", "read"], ["making", "make"], ["studies", "study"],
    ["studied", "study"], ["stopped", "stop"], ["bigger", "big"], ["children", "child"], ["children's", "children"], ["went", "go"]]) {
    const candidates = wordCandidates(input);
    assert.equal(candidates[0], input);
    assert.ok(candidates.includes(expected), input);
    assert.equal(new Set(candidates).size, candidates.length);
  }
});

test("按点击的字符位置抽取整词，保留词内连字符与撇号", () => {
  assert.deepEqual(wordBounds("Read books, slowly.", 7), { word: "books", start: 5, end: 10 });
  assert.equal(wordBounds("Children’s books", 3).word, "children's");
  assert.equal(wordBounds("a well-known writer", 5).word, "well-known");
  assert.equal(wordBounds("...", 1), null);
  assert.equal(wordBounds("read", 99), null);
});
