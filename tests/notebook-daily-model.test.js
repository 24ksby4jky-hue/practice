import test from "node:test";
import assert from "node:assert/strict";
import * as Model from "../src/notebook-model.js";
import * as Daily from "../src/notebook-daily-model.js";

const TODAY = "2026-10-17";
const at = (year, month, day, hour = 9) => new Date(year, month - 1, day, hour, 30).getTime();
const noteOn = (word, day, extra = {}) => ({
  word,
  meaning: `${word} 的释义`,
  at: at(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))),
  ...extra
});
const review = (dueDay, extra = {}) => ({ stage: 0, dueDay, lastAt: 1, correct: 0, wrong: 0, ...extra });
const otherWord = (n) => `word${"abcdefghijklmnopqrstuvwxyz"[n % 26]}${"abcdefghijklmnopqrstuvwxyz"[Math.floor(n / 26)]}`;

/* --------------------------------------------------------------------------
   日期
   -------------------------------------------------------------------------- */

test("addDays 跨月、跨年、负数都对", () => {
  assert.equal(Model.addDays("2026-10-17", 1), "2026-10-18");
  assert.equal(Model.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(Model.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(Model.addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(Model.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(Model.addDays("", 1), "");
});

/* --------------------------------------------------------------------------
   候选词
   -------------------------------------------------------------------------- */

test("候选词排除已掌握、词组和未到期的词", () => {
  const notes = [
    noteOn("alpha", "2026-10-01"),
    noteOn("beta", "2026-10-01", { level: 2 }),
    { word: "new york", meaning: "纽约", at: at(2026, 10, 1) },
    noteOn("gamma", "2026-10-01", { review: review("2026-11-01", { stage: 2 }) }),
    noteOn("delta", "2026-10-01", { review: review(TODAY, { stage: 1 }) })
  ];
  assert.deepEqual(Daily.candidateSummary(notes, TODAY),
    { newCount: 0, dueCount: 2, total: 2 });
  assert.deepEqual(Daily.buildPlanWords(notes, TODAY, 20), ["alpha", "delta"]);
});

test("新词最多占一半名额，复习词排在前面", () => {
  const fresh = Array.from({ length: 10 }, (_, i) => noteOn(otherWord(i), TODAY));
  const due = Array.from({ length: 40 }, (_, i) => noteOn(otherWord(100 + i), "2026-10-01", {
    review: review(Model.addDays("2026-10-01", i % 5))
  }));
  const words = Daily.buildPlanWords([...fresh, ...due], TODAY, 20);
  assert.equal(words.length, 20);
  const freshWords = new Set(fresh.map((item) => item.word));
  assert.equal(words.slice(0, 10).every((word) => !freshWords.has(word)), true);
  assert.equal(words.slice(10).every((word) => freshWords.has(word)), true);
});

test("一边不够就用另一边补足", () => {
  const fresh = Array.from({ length: 3 }, (_, i) => noteOn(otherWord(i), TODAY));
  assert.deepEqual(Daily.buildPlanWords(fresh, TODAY, 20), fresh.map((item) => item.word));

  const due = Array.from({ length: 30 }, (_, i) => noteOn(otherWord(100 + i), "2026-10-01", {
    review: review("2026-10-01")
  }));
  assert.equal(Daily.buildPlanWords(due, TODAY, 20).length, 20);
  assert.deepEqual(Daily.buildPlanWords([], TODAY, 20), []);
});

test("同一个词形只出现一次，大小写不算两个词", () => {
  const notes = [noteOn("Alpha", "2026-10-01"), noteOn("alpha", "2026-10-02")];
  assert.deepEqual(Daily.buildPlanWords(notes, TODAY, 20), ["alpha"]);
});

test("排序确定：到期越早越靠前", () => {
  const notes = [
    noteOn("charlie", "2026-10-01", { review: review("2026-10-15") }),
    noteOn("alpha", "2026-10-01", { review: review("2026-10-10") }),
    noteOn("bravo", "2026-10-01", { review: review("2026-10-12") })
  ];
  assert.deepEqual(Daily.buildPlanWords(notes, TODAY, 20), ["alpha", "bravo", "charlie"]);
});

/* --------------------------------------------------------------------------
   计划
   -------------------------------------------------------------------------- */

test("ensurePlan 只建一次；没有候选就不建空计划", () => {
  const store = Model.addNoteToStore(Model.emptyStore(), { word: "alpha", meaning: "甲" }, at(2026, 10, 1));
  const first = Daily.ensurePlan(store, TODAY, 1);
  assert.equal(first.created, true);
  assert.deepEqual(first.plan.words, ["alpha"]);
  assert.equal(first.plan.results.length, 0);
  assert.equal(first.plan.dailyCount, 20);

  // 计划生成后新收的词不进当天计划
  const withMore = Model.addNoteToStore(first.store, { word: "beta", meaning: "乙" }, at(2026, 10, 17));
  const second = Daily.ensurePlan(withMore, TODAY, 2);
  assert.equal(second.created, false);
  assert.deepEqual(second.plan.words, ["alpha"]);

  const empty = Daily.ensurePlan(Model.emptyStore(), TODAY, 3);
  assert.equal(empty.plan, null);
  assert.equal(empty.created, false);
  assert.deepEqual(empty.store, Model.emptyStore());
});

test("每日词量在建计划时生效，建完再改不影响这一轮", () => {
  const store = {
    ...Model.emptyStore(),
    settings: { dailyCount: 5 },
    notes: Array.from({ length: 12 }, (_, i) => noteOn(otherWord(i), "2026-10-01", { review: review("2026-10-01") }))
  };
  const built = Daily.ensurePlan(store, TODAY, 1);
  assert.equal(built.plan.words.length, 5);
  const changed = Model.setDailyCount(built.store, 10);
  const again = Daily.ensurePlan(changed, TODAY, 2);
  assert.equal(again.created, false);
  assert.equal(again.plan.words.length, 5);
});

test("续听从已判结果的下一个词开始", () => {
  const plan = {
    day: TODAY,
    words: ["alpha", "bravo", "charlie"],
    results: [{ word: "alpha", correct: true }],
    elapsedSeconds: 42
  };
  assert.deepEqual(Daily.resumeState(plan), {
    startIndex: 1,
    results: [{ word: "alpha", isCorrect: true }],
    elapsedSeconds: 42
  });
  assert.deepEqual(Daily.planProgress(plan), {
    total: 3, graded: 1, remaining: 2, correct: 1, wrong: 0, accuracy: 100
  });
});

test("计划里的词补齐释义与音标；词被删掉了也给一条", () => {
  const store = {
    ...Model.emptyStore(),
    notes: [{ word: "alpha", meaning: "甲", at: 1 }]
  };
  const words = Daily.dailySessionNotes(store, { words: ["alpha", "gone"] },
    (word) => (word === "alpha" ? { phonetic: "/ˈælfə/", pos: "n.", example: "例" } : null));
  assert.deepEqual(words[0], { word: "alpha", meaning: "甲", phonetic: "/ˈælfə/", pos: "n.", example: "例" });
  assert.deepEqual(words[1], { word: "gone", meaning: "", phonetic: "", pos: "", example: "" });
});

/* --------------------------------------------------------------------------
   判词与完成
   -------------------------------------------------------------------------- */

function storeWithPlan(words, results = []) {
  return {
    ...Model.emptyStore(),
    notes: words.map((word) => ({ word, meaning: `${word} 的释义`, at: at(2026, 10, 1) })),
    plans: {
      [TODAY]: {
        day: TODAY, words, results,
        startedAt: 1, finishedAt: null, elapsedSeconds: 0, dailyCount: 20, builtAt: 1
      }
    }
  };
}

test("判词只接受下一个该判的词，并更新生词档位", () => {
  const store = storeWithPlan(["alpha", "beta"]);
  // 先判第二个词会被忽略 —— 续听下标不能跳
  assert.equal(Daily.applyGradeToStore(store, TODAY, "beta", true, 5), store);

  const next = Daily.applyGradeToStore(store, TODAY, "alpha", true, 5);
  assert.equal(next.plans[TODAY].results.length, 1);
  assert.deepEqual(next.plans[TODAY].results[0], { word: "alpha", correct: true, at: 5 });
  assert.equal(next.notes[0].review.stage, 1);
  assert.equal(next.notes[0].review.dueDay, "2026-10-18");
  assert.equal(next.notes[1].review, undefined);

  // 同一个词重复判不重复入账
  const again = Daily.applyGradeToStore(next, TODAY, "alpha", false, 6);
  assert.deepEqual(again.plans[TODAY].results, next.plans[TODAY].results);
});

test("完成一轮写一条历史；重复完成不重复记；零判词不算完成", () => {
  const graded = Daily.applyGradeToStore(
    Daily.applyGradeToStore(storeWithPlan(["alpha", "beta"]), TODAY, "alpha", true, 5),
    TODAY, "beta", false, 6
  );
  const done = Daily.finishPlan(graded, TODAY, 1000, 90);
  assert.equal(done.history.length, 1);
  assert.deepEqual(done.history[0], {
    day: TODAY, finishedAt: 1000, planned: 2, graded: 2,
    correct: 1, accuracy: 50, elapsedSeconds: 90, missed: ["beta"]
  });
  assert.equal(done.plans[TODAY].finishedAt, 1000);
  assert.equal(done.plans[TODAY].elapsedSeconds, 90);

  // 幂等
  assert.equal(Daily.finishPlan(done, TODAY, 2000, 120), done);
  // 一个词都没判过不算完成
  const untouched = storeWithPlan(["alpha"]);
  assert.equal(Daily.finishPlan(untouched, TODAY, 1, 1), untouched);
});

test("用时只在变化时落盘", () => {
  const store = storeWithPlan(["alpha"]);
  const touched = Daily.touchPlan(store, TODAY, 7);
  assert.equal(touched.plans[TODAY].elapsedSeconds, 7);
  assert.equal(Daily.touchPlan(touched, TODAY, 7), touched);
});

/* --------------------------------------------------------------------------
   今日状态、连续天数、日历
   -------------------------------------------------------------------------- */

test("今日状态：empty / ready / in-progress / done", () => {
  assert.equal(Daily.dailyStatus(Model.emptyStore(), TODAY).state, "empty");
  assert.equal(Daily.dailyStatus(Model.emptyStore(), TODAY).canStart, false);

  const store = Model.addNoteToStore(Model.emptyStore(), { word: "alpha", meaning: "甲" }, at(2026, 10, 1));
  const before = Daily.dailyStatus(store, TODAY);
  assert.equal(before.state, "ready");
  assert.equal(before.canStart, true);

  const grading = Daily.dailyStatus(
    Daily.applyGradeToStore({ ...store, plans: { [TODAY]: { ...Daily.ensurePlan(store, TODAY, 1).plan } } },
      TODAY, "alpha", true, 5),
    TODAY);
  assert.equal(grading.state, "in-progress");
  assert.equal(grading.graded, 1);
  assert.equal(grading.remaining, 0);
});

test("连续天数：今天没做从昨天数，断档归零", () => {
  const withHistory = (days) => ({
    ...Model.emptyStore(),
    history: days.map((day, index) => ({
      day, finishedAt: index + 1, planned: 1, graded: 1, correct: 1,
      accuracy: 100, elapsedSeconds: 10, missed: []
    }))
  });
  assert.equal(Daily.streakOf(withHistory(["2026-10-17", "2026-10-16", "2026-10-15"]), TODAY).current, 3);
  assert.equal(Daily.streakOf(withHistory(["2026-10-16", "2026-10-15"]), TODAY).current, 2);
  assert.equal(Daily.streakOf(withHistory(["2026-10-15"]), TODAY).current, 0);
  assert.equal(Daily.streakOf(withHistory(["2026-10-15"]), TODAY).totalDays, 1);
  assert.equal(Daily.streakOf(withHistory(["2026-10-13", "2026-10-14", "2026-10-16", "2026-10-17"]), TODAY).longest, 2);
});

test("日历 30 天，标出完成 / 部分 / 错过", () => {
  const plan = (day, results, finishedAt) => ({
    day, words: ["alpha", "bravo"], results, finishedAt,
    startedAt: 1, elapsedSeconds: 10, dailyCount: 20, builtAt: 1
  });
  const store = {
    ...Model.emptyStore(),
    plans: {
      "2026-10-17": plan("2026-10-17", [{ word: "alpha", correct: true }], 5),
      "2026-10-16": plan("2026-10-16", [{ word: "alpha", correct: true }], null),
      "2026-10-15": plan("2026-10-15", [], null)
    }
  };
  const days = Daily.calendarDays(store, TODAY, 3);
  assert.deepEqual(days.map((item) => item.state), ["missed", "partial", "done"]);
  assert.equal(days[2].today, true);
  assert.equal(days[2].accuracy, 100);
  assert.equal(days[2].planned, 2);
  assert.equal(days[1].graded, 1);
});

/* --------------------------------------------------------------------------
   备份
   -------------------------------------------------------------------------- */

test("导出再导入：版本正确，坏文件整份拒绝", () => {
  const store = Model.addNoteToStore(Model.emptyStore(), { word: "alpha", meaning: "甲" }, 10);
  const payload = Daily.exportPayload(store, 99);
  assert.equal(payload.version, 2);
  assert.equal(payload.exportedAt, 99);

  const parsed = Daily.parseBackup(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.store.notes, store.notes);

  assert.equal(Daily.parseBackup("不是 JSON").ok, false);
  assert.equal(Daily.parseBackup("").ok, false);
  assert.equal(Daily.parseBackup(JSON.stringify({ version: 3, notes: [] })).error, "备份来自更新版本");
  assert.equal(Daily.parseBackup(JSON.stringify({ notes: [] })).ok, false);

  // 旧版裸数组也能导入
  const legacy = Daily.parseBackup(JSON.stringify([{ word: "beta", meaning: "乙", at: 1 }]));
  assert.equal(legacy.ok, true);
  assert.deepEqual(legacy.store.notes.map((item) => item.word), ["beta"]);
});

test("导入合并只增不减，同一个词留复习更深的", () => {
  const local = Model.addNoteToStore(Model.emptyStore(), { word: "alpha", meaning: "甲" }, 10);
  const imported = {
    ...Model.emptyStore(),
    notes: [
      { word: "alpha", meaning: "甲（新）", at: 20,
        review: { stage: 3, dueDay: "2026-11-01", lastAt: 5, correct: 3, wrong: 0 } },
      { word: "beta", meaning: "乙", at: 30 }
    ]
  };
  const merged = Daily.mergeStores(local, imported);
  assert.deepEqual(merged.notes.map((item) => item.word).sort(), ["alpha", "beta"]);
  const alpha = merged.notes.find((item) => item.word === "alpha");
  assert.equal(alpha.review.stage, 3);
  assert.equal(alpha.meaning, "甲（新）");
  // 本地设置不被导入文件覆盖
  assert.equal(merged.settings.dailyCount, 20);
});
