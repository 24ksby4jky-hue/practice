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
    level: 0,
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

/* --------------------------------------------------------------------------
   掌握程度
   -------------------------------------------------------------------------- */

test("三档掌握程度，默认那档不落盘 —— 老记录的形状一个字都不用改", () => {
  assert.deepEqual(model.LEVELS.map((l) => l.id), [0, 1, 2]);
  assert.deepEqual(model.LEVELS.map((l) => l.name), ["没记住", "在记", "记住了"]);
  // 刚答错收进来的词没有 level 字段
  const fresh = model.addNote([], { word: "cue", meaning: "提示" }, 5);
  assert.equal("level" in fresh[0], false);
  assert.equal(model.levelOf(fresh[0]), 0);
  assert.equal(model.levelOf({ word: "x", meaning: "y", at: 1, level: 2 }), 2);
});

test("认不出来的档位一律当 0 读，不写脏数据", () => {
  assert.equal(model.levelOf({ level: 9 }), 0);
  assert.equal(model.levelOf({ level: "2" }), 0);
  assert.equal(model.levelOf(null), 0);
  const list = [{ word: "a", meaning: "甲", at: 1 }];
  // 非法档位原样返回
  assert.deepEqual(model.setLevel(list, "a", 7), list);
  assert.deepEqual(model.setLevel(list, "a", "1"), list);
});

test("setLevel 只动那一个词，改不动的不写进去", () => {
  const list = [
    { word: "a", meaning: "甲", at: 2 },
    { word: "b", meaning: "乙", at: 1 }
  ];
  const next = model.setLevel(list, "a", 2);
  assert.equal(model.levelOf(next[0]), 2);
  assert.equal(model.levelOf(next[1]), 0);
  // 改不动不存在的词
  assert.deepEqual(model.setLevel(list, "zzz", 2).map((n) => model.levelOf(n)), [0, 0]);
  // 坏入参不抛错，也不会把列表吃掉
  assert.deepEqual(model.setLevel(null, "a", 1), []);
  assert.deepEqual(model.setLevel([null, "x", list[0]], "a", 1).length, 1);
});

test("每一档各有多少词", () => {
  const list = [
    { word: "a", meaning: "甲", at: 5 },
    { word: "b", meaning: "乙", at: 4, level: 2 },
    { word: "c", meaning: "丙", at: 3, level: 2 },
    { word: "d", meaning: "丁", at: 2, level: 1 }
  ];
  assert.deepEqual(model.countsByLevel(list), { all: 4, 0: 1, 1: 1, 2: 2 });
  assert.deepEqual(model.countsByLevel(null), { all: 0, 0: 0, 1: 0, 2: 0 });
});

/* --------------------------------------------------------------------------
   来源
   -------------------------------------------------------------------------- */

const BOARDS = [
  { id: "campus", name: "校园生活", units: [
    { words: [{ word: "schedule" }, { word: "library" }] },
    { words: [{ word: "thesis" }] }
  ] },
  { id: "work", name: "工作与职业", units: [{ words: [{ word: "resume" }] }] }
];

test("来源是现查的：单元没有编号字段，序号就是数组下标 + 1", () => {
  // 这一点跟 dictation.js 取词一样（units[unitNumber - 1]），不能猜
  const index = model.sourceIndex(BOARDS);
  assert.deepEqual(index.schedule, { boardId: "campus", boardName: "校园生活", unit: 1 });
  assert.deepEqual(index.thesis, { boardId: "campus", boardName: "校园生活", unit: 2 });
  assert.deepEqual(index.resume, { boardId: "work", boardName: "工作与职业", unit: 1 });
});

test("来源坏数据不抛错", () => {
  assert.deepEqual(model.sourceIndex(null), {});
  assert.deepEqual(model.sourceIndex([null, { units: null }, { units: [null, {}] }]), {});
});

test("给了来源表才往结果里塞 source —— 老调用方的形状不变", () => {
  const notes = [{ word: "schedule", meaning: "日程", at: 1 }];
  const withSource = model.enrich(notes, () => null, model.sourceIndex(BOARDS))[0];
  assert.equal(withSource.source.boardName, "校园生活");
  assert.equal(withSource.source.unit, 1);
  // 不给就不该有这个键
  assert.equal("source" in model.enrich(notes, () => null)[0], false);
  // 词表里没有的词没有来源
  const orphan = model.enrich([{ word: "gone", meaning: "没了", at: 1 }], () => null, model.sourceIndex(BOARDS))[0];
  assert.equal(orphan.source, null);
});

/* --------------------------------------------------------------------------
   筛选与排序
   -------------------------------------------------------------------------- */

const MIXED = [
  { word: "alpha", meaning: "甲，第一个", at: 5 },
  { word: "beta", meaning: "乙", at: 4, level: 2 },
  { word: "gamma", meaning: "丙 alpha 也在这里", at: 3, level: 1 },
  { word: "delta", meaning: "丁", at: 2, level: 2 }
];

test("按掌握程度筛", () => {
  assert.deepEqual(model.filterNotes(MIXED, "all").map((n) => n.word), ["alpha", "beta", "gamma", "delta"]);
  assert.deepEqual(model.filterNotes(MIXED, 0).map((n) => n.word), ["alpha"]);
  assert.deepEqual(model.filterNotes(MIXED, 1).map((n) => n.word), ["gamma"]);
  assert.deepEqual(model.filterNotes(MIXED, 2).map((n) => n.word), ["beta", "delta"]);
  // 不给档位就是全部
  assert.equal(model.filterNotes(MIXED).length, 4);
});

test("搜索命中词，也命中释义；大小写不敏感", () => {
  assert.deepEqual(model.filterNotes(MIXED, "all", "ALPHA").map((n) => n.word), ["alpha", "gamma"]);
  assert.deepEqual(model.filterNotes(MIXED, "all", "乙").map((n) => n.word), ["beta"]);
  // 空格和空串都当没搜
  assert.equal(model.filterNotes(MIXED, "all", "   ").length, 4);
  assert.equal(model.filterNotes(MIXED, "all", null).length, 4);
  assert.deepEqual(model.filterNotes(MIXED, "all", "找不到的").map((n) => n.word), []);
});

test("筛选和搜索叠加", () => {
  assert.deepEqual(model.filterNotes(MIXED, 2, "a").map((n) => n.word), ["beta", "delta"]);
  assert.deepEqual(model.filterNotes(MIXED, 1, "乙").map((n) => n.word), []);
});

test("按掌握程度排：记住的沉到底下，同档按时间新的在前", () => {
  assert.deepEqual(model.sortNotes(MIXED, "level").map((n) => n.word), ["alpha", "gamma", "beta", "delta"]);
});

test("默认按加入时间，新的在前", () => {
  assert.deepEqual(model.sortNotes(MIXED).map((n) => n.word), ["alpha", "beta", "gamma", "delta"]);
  const shuffled = [MIXED[2], MIXED[0], MIXED[3]];
  assert.deepEqual(model.sortNotes(shuffled).map((n) => n.word), ["alpha", "gamma", "delta"]);
});

test("排序不改原数组，坏数据不抛错", () => {
  const before = MIXED.map((n) => n.word);
  model.sortNotes(MIXED, "level");
  assert.deepEqual(MIXED.map((n) => n.word), before);
  assert.deepEqual(model.sortNotes(null, "level"), []);
  assert.deepEqual(model.filterNotes(null, 0, "x"), []);
});
