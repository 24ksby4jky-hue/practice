import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../src/notebook-model.js";

test("存储键钉死 —— 改名字等于把用户存的词丢掉", () => {
  assert.equal(model.NOTE_KEY, "dictationNotebook:guest");
  assert.equal(model.NOTE_LIMIT, 40);
});

test("readNotes 遇到什么坏数据都返回空数组，不抛错", () => {
  assert.deepEqual(model.readNotes(null), []);
  assert.deepEqual(model.readNotes(undefined), []);
  assert.deepEqual(model.readNotes(""), []);
  assert.deepEqual(model.readNotes("这不是 JSON"), []);
  assert.deepEqual(model.readNotes("{}"), []);
  assert.deepEqual(model.readNotes('"x"'), []);
  assert.deepEqual(model.readNotes("5"), []);
});

test("readNotes 丢掉形状不对的条目，留下合法的", () => {
  const raw = JSON.stringify([
    { word: "cue", meaning: "提示", at: 1 },
    null,
    { meaning: "没有 word" },
    { word: "orphan" },
    { word: "", meaning: "空 word" },
    { word: "drill", meaning: " drill 释义", at: 2 }
  ]);
  assert.deepEqual(model.readNotes(raw), [
    { word: "cue", meaning: "提示", at: 1 },
    { word: "drill", meaning: " drill 释义", at: 2 }
  ]);
});

test("addNote 把新词放在最前，且只存 word / meaning / at", () => {
  const next = model.addNote([], { word: "cue", meaning: "提示" }, 1000);
  assert.deepEqual(next, [{ word: "cue", meaning: "提示", at: 1000 }]);
  // 音标、词性、例句不落盘 —— 它们靠 enrich 现查
  assert.deepEqual(Object.keys(next[0]), ["word", "meaning", "at"]);
});

test("addNote 同一个词重复记不新增，也不刷新 at", () => {
  const list = [{ word: "cue", meaning: "提示", at: 1000 }];
  const next = model.addNote(list, { word: "cue", meaning: "另写的释义" }, 2000);
  assert.equal(next.length, 1);
  assert.equal(next[0].at, 1000);
  assert.equal(next[0].meaning, "提示");
});

test("addNote 到 41 个只留最新 40 个", () => {
  let list = [];
  for (let i = 0; i < 40; i += 1) {
    list = model.addNote(list, { word: `word${i}`, meaning: `释义${i}` }, i);
  }
  assert.equal(list.length, 40);
  const next = model.addNote(list, { word: "最新", meaning: "最新的词" }, 99);
  assert.equal(next.length, 40);
  assert.equal(next[0].word, "最新");
  assert.equal(next.some((item) => item.word === "word0"), false);
});

test("addNote 遇到坏入参不加垃圾条目", () => {
  const list = [{ word: "cue", meaning: "提示", at: 1 }];
  assert.deepEqual(model.addNote(list, null, 2), list);
  assert.deepEqual(model.addNote(list, { meaning: "没有 word" }, 2), list);
  assert.deepEqual(model.addNote(list, { word: "" }, 2), list);
  assert.deepEqual(model.addNote(null, { word: "cue", meaning: "x" }, 2),
    [{ word: "cue", meaning: "x", at: 2 }]);
});

test("addNote 不改动传进来的数组", () => {
  const list = [{ word: "cue", meaning: "提示", at: 1 }];
  const before = JSON.parse(JSON.stringify(list));
  model.addNote(list, { word: "drill", meaning: " drill" }, 2);
  assert.deepEqual(list, before);
});

test("removeNote 只摘掉那一个，其余顺序不变", () => {
  const list = [
    { word: "a", meaning: "甲", at: 3 },
    { word: "b", meaning: "乙", at: 2 },
    { word: "c", meaning: "丙", at: 1 }
  ];
  assert.deepEqual(model.removeNote(list, "b"), [
    { word: "a", meaning: "甲", at: 3 },
    { word: "c", meaning: "丙", at: 1 }
  ]);
  // 不在列表里就是原样
  assert.deepEqual(model.removeNote(list, "zzz"), list);
  assert.deepEqual(model.removeNote(null, "a"), []);
});

test("clearNotes 给的是空列表", () => {
  assert.deepEqual(model.clearNotes(), []);
});

test("wordIndex 把 板块 → 单元 → 词 摊平成一张表", () => {
  const boards = [
    { units: [{ words: [{ word: "a", pos: "n." }, { word: "b", pos: "v." }] }] },
    { units: [{ words: [{ word: "c", pos: "adj." }] }, { words: [{ word: "d" }] }] }
  ];
  const index = model.wordIndex(boards);
  assert.deepEqual(Object.keys(index).sort(), ["a", "b", "c", "d"]);
  assert.equal(index.a.pos, "n.");
  assert.deepEqual(model.wordIndex(null), {});
  assert.deepEqual(model.wordIndex([null, { units: null }]), {});
});

test("enrich 查得到的词补上音标词性例句", () => {
  const index = { cue: { word: "cue", pos: "n.", phonetic: "/kjuː/", example: "That was my cue." } };
  const notes = [{ word: "cue", meaning: "提示", at: 5 }];
  assert.deepEqual(model.enrich(notes, (w) => index[w] || null), [{
    word: "cue",
    meaning: "提示",
    at: 5,
    pos: "n.",
    phonetic: "/kjuː/",
    example: "That was my cue.",
    missing: false
  }]);
});

test("enrich 词表里没有的标 missing，保留用户当时记的释义", () => {
  const notes = [{ word: "早已不在词表", meaning: "当时记下的", at: 7 }];
  const out = model.enrich(notes, () => null);
  assert.equal(out[0].missing, true);
  assert.equal(out[0].meaning, "当时记下的");
  assert.equal(out[0].word, "早已不在词表");
  // 没有音标字段，不是 undefined 占位
  assert.equal("phonetic" in out[0], false);
});

test("enrich 存下来的释义优先于词表里的", () => {
  const notes = [{ word: "cue", meaning: "用户看到的那条", at: 1 }];
  const out = model.enrich(notes, () => ({ word: "cue", meaning: "词表里的另一条", pos: "n." }));
  assert.equal(out[0].meaning, "用户看到的那条");
  assert.equal(out[0].pos, "n.");
});

test("enrich 保持顺序，坏入参不抛错", () => {
  const notes = [
    { word: "a", meaning: "甲", at: 2 },
    { word: "b", meaning: "乙", at: 1 }
  ];
  assert.deepEqual(model.enrich(notes, () => null).map((n) => n.word), ["a", "b"]);
  assert.deepEqual(model.enrich(null, () => null), []);
  // lookup 不是函数时当作查不到
  assert.equal(model.enrich(notes, null)[0].missing, true);
});
