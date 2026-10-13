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

test("backspace drops wrong records at or after the new caret", () => {
  const records = [{ index: 0 }, { index: 2 }, { index: 3 }];
  assert.deepEqual(model.pruneWrongRecords(records, 2), [{ index: 0 }]);
  assert.deepEqual(model.pruneWrongRecords(records, 0), []);
});

test("trailing combo counts only the matching suffix", () => {
  const chars = [{ char: "a" }, { char: "b" }, { char: "c" }];
  assert.equal(model.trailingCombo(chars, "abc"), 3);
  assert.equal(model.trailingCombo(chars, "ab"), 2);
  assert.equal(model.trailingCombo(chars, "abX"), 0);
  assert.equal(model.trailingCombo(chars, "axc"), 1);
  assert.equal(model.maxCombo(chars, "abXc"), 2);
});

test("persist only a finished text or a visible timeout", () => {
  assert.equal(model.shouldPersist({
    inputLength: 5, totalCount: 5, timedExpired: false, typingViewVisible: true
  }), true);
  assert.equal(model.shouldPersist({
    inputLength: 4, totalCount: 5, timedExpired: false, typingViewVisible: true
  }), false);
  assert.equal(model.shouldPersist({
    inputLength: 1, totalCount: 5, timedExpired: true, typingViewVisible: true
  }), true);
  assert.equal(model.shouldPersist({
    inputLength: 1, totalCount: 5, timedExpired: true, typingViewVisible: false
  }), false);
  assert.equal(model.shouldPersist({
    inputLength: 0, totalCount: 0, timedExpired: false, typingViewVisible: true
  }), false);
});

test("timer elapsed time pauses and resumes from a timestamp", () => {
  const running = { accumulatedMs: 1000, running: true, segmentStartedAt: 5000 };
  assert.equal(model.elapsedMs(running, 6500), 2500);
  const paused = model.pauseTimer(running, 6500);
  assert.deepEqual(paused, { accumulatedMs: 2500, running: false, segmentStartedAt: null });
  assert.equal(model.elapsedMs(paused, 9000), 2500);
  const again = model.resumeTimer(paused, 9000);
  assert.deepEqual(again, { accumulatedMs: 2500, running: true, segmentStartedAt: 9000 });
  assert.equal(model.elapsedMs(again, 9500), 3000);
});

test("resume only an in-progress free or timed session", () => {
  assert.equal(model.shouldResume({
    mode: "free", typingStarted: false, timedApplied: false, finished: false
  }), false);
  assert.equal(model.shouldResume({
    mode: "free", typingStarted: true, timedApplied: false, finished: false
  }), true);
  assert.equal(model.shouldResume({
    mode: "timed", typingStarted: false, timedApplied: true, finished: false
  }), true);
  assert.equal(model.shouldResume({
    mode: "timed", typingStarted: false, timedApplied: true, finished: true
  }), false);
});

test("remaining time reaches zero without going negative", () => {
  assert.equal(model.timedRemainSeconds(60, 1500), 59);
  assert.equal(model.timedRemainSeconds(60, 60000), 0);
  assert.equal(model.timedRemainSeconds(60, 61000), 0);
});

test("custom ids increase and storage keys use the article id", () => {
  assert.deepEqual(model.nextCustomId(0), { id: "custom-1", serial: 1 });
  assert.deepEqual(model.nextCustomId(2), { id: "custom-3", serial: 3 });
  assert.deepEqual(model.storageKeys("morning-platform"), {
    errors: "typingCumulativeErrors:guest",
    stats: "typingArticleStats:guest",
    review: "typingReview:morning-platform:guest",
    done: "typingExercise:morning-platform:guest",
    customSerial: "typingCustomSerial:guest"
  });
});

test("old title-keyed stats are ignored (legacy fields are preserved and not used)", () => {
  assert.deepEqual(model.articleStatsFromStorage(null), { byId: {} });
  assert.deepEqual(model.articleStatsFromStorage([]), { byId: {} });
  assert.deepEqual(model.articleStatsFromStorage("x"), { byId: {} });
  assert.deepEqual(model.articleStatsFromStorage({ byTitle: { Morning: {} } }), { byTitle: { Morning: {} }, byId: {} });
  assert.deepEqual(model.articleStatsFromStorage({ byId: [] }), { byId: {} });
  const kept = { byId: { "morning-platform": { practiceCount: 1 } } };
  assert.deepEqual(model.articleStatsFromStorage(kept), kept);
});

test("writeJson reports quota failures and stores JSON", () => {
  const failing = { setItem() { throw new Error("quota"); } };
  assert.equal(model.writeJson(failing, "k", { a: 1 }), false);
  const saved = {};
  const storage = { setItem(key, value) { saved[key] = value; } };
  assert.equal(model.writeJson(storage, "k", { a: 1 }), true);
  assert.equal(saved.k, "{\"a\":1}");
});

test("typing view is every view except dictation", () => {
  assert.equal(model.isTypingView("typing"), true);
  assert.equal(model.isTypingView(undefined), true);
  assert.equal(model.isTypingView("dictation"), false);
});
