const test = require("node:test");
const assert = require("node:assert/strict");
const board = require("../../dictation/words/campus.js");
const { assertBoard } = require("../dictation-words-support.js");

test("campus board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "campus", name: "校园生活" });
});

test("campus unit 1 keeps the original six words in order", () => {
  assert.deepEqual(board.units[0].words.slice(0, 6), [
    { word: "schedule", pos: "n.", phonetic: "/ˈʃedjuːl/", meaning: "日程，时间表", example: "She checked the schedule before leaving for class." },
    { word: "library", pos: "n.", phonetic: "/ˈlaɪbrəri/", meaning: "图书馆", example: "The library stays open until ten at night." },
    { word: "assignment", pos: "n.", phonetic: "/əˈsaɪnmənt/", meaning: "作业，任务", example: "The assignment is due on Friday morning." },
    { word: "deadline", pos: "n.", phonetic: "/ˈdedlaɪn/", meaning: "截止日期", example: "Missing the deadline costs ten percent of the mark." },
    { word: "lecture", pos: "n.", phonetic: "/ˈlektʃər/", meaning: "讲座", example: "The lecture explained how glaciers move." },
    { word: "semester", pos: "n.", phonetic: "/sɪˈmestər/", meaning: "学期", example: "This semester she is taking four courses." }
  ]);
});
