import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../src/dictation/dictation-model.js";

test("dictation model core behavior", () => {
  assert.equal(model.shouldMarkUnitDone({ kind: "unit", resultCount: 20, skipped: true }), true);
  assert.equal(model.shouldMarkUnitDone({ kind: "unit", resultCount: 20, skipped: false }), true);
  assert.equal(model.shouldMarkUnitDone({ kind: "review", resultCount: 20 }), false);
  assert.equal(model.shouldMarkUnitDone({ kind: "unit", resultCount: 19 }), false);
  assert.equal(model.shouldMarkUnitDone({ kind: "unit", resultCount: 21 }), false);

  const saved = { campus: { "1": true } };
  const next = model.markUnitDone(saved, "charts", 3);
  assert.equal(model.isUnitDone(next, "campus", 1), true);
  assert.equal(model.isUnitDone(next, "charts", 3), true);
  assert.equal(model.isUnitDone(saved, "charts", 3), false);
  assert.deepEqual(model.markUnitDone(next, "charts", "3"), next);

  assert.deepEqual(model.readUnitDone(null), {});
  assert.deepEqual(model.readUnitDone(["campus"]), {});
  assert.deepEqual(model.readUnitDone({ campus: { "1": false, "2": true, "0": true, "26": true } }), { campus: { "2": true } });

  assert.deepEqual(model.unitRange(1), { start: 1, end: 20 });
  assert.deepEqual(model.unitRange(7), { start: 121, end: 140 });
  assert.deepEqual(model.unitRange(25), { start: 481, end: 500 });

  assert.equal(model.progressLabel({ review: false, index: 2, total: 20, boardName: "校园生活", unitNumber: 7 }), "练习 3 / 20 · 校园生活 · 第 7 组");
  assert.equal(model.progressLabel({ review: true, index: 0, total: 4, boardName: "校园生活", unitNumber: 7 }), "复习 1 / 4 · 校园生活 · 第 7 组");
  assert.equal(model.DICTATION_SUBTITLE, "听发音，把单词拼进空格。错字母会标红。看答案这一词算错。");
  assert.equal(model.unitDoneKey(), "dictationUnitDone:guest");

  assert.equal(model.isDictationWord("part-time"), true);
  assert.equal(model.isDictationWord("it's"), true);
  assert.equal(model.isDictationWord("part time"), false);
  assert.equal(model.isDictationWord("GDP"), false);
  assert.equal(model.isDictationWord("CO2"), false);
  assert.equal(model.isDictationWord("Schedule"), false);

  assert.deepEqual(model.enterDictation({ screen: "session", boardId: "charts", unitNumber: 4, wordIndex: 11 }), { screen: "picker", boardId: "campus" });
  assert.deepEqual(model.selectBoard("charts"), { screen: "picker", boardId: "charts" });
  assert.deepEqual(model.startUnit("campus", 7), { screen: "session", boardId: "campus", unitNumber: 7, kind: "unit", wordIndex: 0 });
  assert.deepEqual(model.startReview("campus", 7), { screen: "session", boardId: "campus", unitNumber: 7, kind: "review", wordIndex: 0 });
  assert.deepEqual(model.returnToUnits("charts"), { screen: "picker", boardId: "charts" });
  assert.deepEqual(model.sessionOutcome({ kind: "unit", boardId: "campus", unitNumber: 7, skipped: true }, 20), { mark: true, screen: "report", boardId: "campus", unitNumber: 7 });
  assert.deepEqual(model.sessionOutcome({ kind: "review", boardId: "campus", unitNumber: 7 }, 20), { mark: false, screen: "report", boardId: "campus", unitNumber: 7 });
  assert.deepEqual(model.BOARDS.map((board) => board.id), ["campus", "academic-writing", "charts", "daily-life", "city-travel", "work", "health-environment", "tech-society"]);
});
