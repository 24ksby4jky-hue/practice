import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dictionaryRoutes } from "./fixtures/dictionary.js";

const KEY = "dictationNotebook:guest";

const pad = (value) => String(value).padStart(2, "0");
function dayText(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function atMs(offsetDays) {
  const date = new Date();
  date.setHours(9, 30, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.getTime();
}

function dueNote(word, offsetDays = 10) {
  return {
    word,
    meaning: `${word} 的释义`,
    at: atMs(-offsetDays),
    review: { stage: 1, dueDay: dayText(-1), lastAt: atMs(-offsetDays), correct: 1, wrong: 0 }
  };
}

async function seed(page, notes, settings = { dailyCount: 20 }) {
  const store = { version: 2, notes, plans: {}, history: [], settings };
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
  }, { key: KEY, value: store });
}

async function enterNotebook(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /生词本.*听写与阅读/ }).click();
  await expect(page.locator(".daily-card")).toBeVisible();
}

function todayStore(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
}

test("今日计划由到期复习与当天新词组成，完成后入账并打卡", async ({ page }) => {
  await dictionaryRoutes(page);
  // 朗读用桩替换掉，测试环境不真的发声
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { value: { cancel() {}, speak() {} } });
  });
  const notes = [
    dueNote("charlie"), dueNote("delta"), dueNote("echo"), dueNote("foxtrot"),
    { word: "alpha", meaning: "阿尔法", at: atMs(0) },
    { word: "bravo", meaning: "布拉沃", at: atMs(0) },
    // 已掌握的词不进计划；词组不能听写
    { ...dueNote("golf"), level: 2 },
    { word: "new york", meaning: "纽约", at: atMs(-3) }
  ];
  await seed(page, notes);
  await enterNotebook(page);

  await expect(page.locator(".daily-head .hint")).toContainText("新词 2");
  await expect(page.locator(".daily-head .hint")).toContainText("复习 4");

  await page.locator(".daily-start").click();
  await expect(page.locator("#dict-progress")).toContainText("/ 6");
  await expect(page.locator("#dict-progress")).toContainText("每日生词");

  const today = dayText();
  const planned = (await todayStore(page)).plans[today].words;
  expect(planned).toHaveLength(6);
  // 已掌握和词组都不在计划里
  expect(planned).not.toContain("golf");
  expect(planned).not.toContain("new york");

  for (const word of planned) {
    await page.keyboard.type(word);
    await expect(page.locator("#dict-answer .ok-label")).toHaveText("正确");
    await page.locator("#dict-next").click();
  }
  await expect(page.locator("#dict-report")).toContainText("每日听写完成");

  const stored = await todayStore(page);
  expect(stored.plans[today].results).toHaveLength(6);
  expect(stored.plans[today].finishedAt).toBeTruthy();
  expect(stored.history).toHaveLength(1);
  expect(stored.history[0]).toMatchObject({ day: today, graded: 6, correct: 6, accuracy: 100 });
  // 答对升一档：stage 1 -> 2，下次复习 = 今天 + 3 天
  const charlie = stored.notes.find((note) => note.word === "charlie");
  expect(charlie.review.stage).toBe(2);
  expect(charlie.review.dueDay).toBe(dayText(3));

  await page.getByRole("button", { name: "返回生词本", exact: true }).click();
  await expect(page.locator(".note-row")).toHaveCount(8);
  await expect(page.locator(".note-row .note-review").first()).toBeVisible();
  await expect(page.locator(".note-history")).toContainText("听写记录");
  await expect(page.locator(".daily-start")).toHaveText("今日已完成");
});

test("中途返回生词本，再进从下一个词继续", async ({ page }) => {
  await dictionaryRoutes(page);
  await seed(page, [
    dueNote("charlie"), dueNote("delta"), dueNote("echo"),
    dueNote("foxtrot"), dueNote("hotel"), dueNote("india")
  ]);
  await enterNotebook(page);

  await page.locator(".daily-start").click();
  await expect(page.locator("#dict-progress")).toContainText("/ 6");
  await page.locator("#dict-reveal").click();
  await page.locator("#dict-next").click();
  await page.locator("#dict-reveal").click();
  await page.locator("#dict-next").click();
  await page.locator("#dict-back").click();

  await expect(page.locator(".daily-start")).toContainText("继续听写（2 / 6）");
  await page.locator(".daily-start").click();
  await expect(page.locator("#dict-progress")).toContainText("3 / 6");
});

test("每日词量可调，但不会换掉已经开始的计划", async ({ page }) => {
  await dictionaryRoutes(page);
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
    "golf", "hotel", "india", "juliet", "kilo", "lima"];
  await seed(page, words.map((word) => dueNote(word)));
  await enterNotebook(page);

  const count = page.locator(".daily-count input");
  await count.fill("10");
  await count.press("Tab");
  await page.locator(".daily-start").click();
  await expect(page.locator("#dict-progress")).toContainText("/ 10");

  await page.locator("#dict-back").click();
  const again = page.locator(".daily-count input");
  await again.fill("20");
  await again.press("Tab");

  const today = dayText();
  const stored = await todayStore(page);
  expect(stored.plans[today].words).toHaveLength(10);
  expect(stored.settings.dailyCount).toBe(20);
});

test("导出备份后再导入，只合并不丢本地词", async ({ page }) => {
  await dictionaryRoutes(page);
  await seed(page, [
    { word: "alpha", meaning: "阿尔法", at: atMs(0) },
    { word: "bravo", meaning: "布拉沃", at: atMs(-1) }
  ]);
  await enterNotebook(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出备份" }).click()
  ]);
  const path = await download.path();
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.version).toBe(2);
  expect(exported.notes).toHaveLength(2);

  const backup = {
    version: 2,
    notes: [{ word: "imported", meaning: "导入的词", at: 5 }],
    plans: {},
    history: [],
    settings: { dailyCount: 20 }
  };
  await page.locator(".note-backup input[type=file]").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator(".note-backup")).toContainText("将合并 1 个词");
  await page.getByRole("button", { name: "确认合并" }).click();
  await expect(page.locator(".note-backup")).toContainText("已导入");

  await expect(page.locator(".note-row")).toHaveCount(3);
  await expect(page.locator(".note-row .note-word", { hasText: /^imported$/ })).toHaveCount(1);
  const stored = await todayStore(page);
  expect(stored.notes.map((note) => note.word).sort()).toEqual(["alpha", "bravo", "imported"]);
});

test("写盘失败时记录留在内存并提示导出，恢复后继续落盘", async ({ page }) => {
  await dictionaryRoutes(page);
  await seed(page, [dueNote("alpha"), dueNote("bravo"), dueNote("charlie")]);
  await enterNotebook(page);

  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Storage is full", "QuotaExceededError");
      original.call(this, name, value);
    };
    window.restoreNotebookStorage = () => { Storage.prototype.setItem = original; };
  }, KEY);

  await page.locator(".daily-start").click();
  await page.locator("#dict-reveal").click();
  await page.locator("#dict-next").click();
  await page.locator("#dict-back").click();

  await expect(page.locator(".storage-warning")).toContainText("只在内存里");
  await expect(page.locator(".daily-start")).toContainText("继续听写（1 / 3）");

  await page.evaluate(() => window.restoreNotebookStorage());
  await page.locator(".daily-start").click();
  await page.locator("#dict-reveal").click();
  await page.locator("#dict-next").click();
  await page.locator("#dict-back").click();

  await expect(page.locator(".storage-warning")).toHaveCount(0);
  const today = dayText();
  const stored = await todayStore(page);
  expect(stored.plans[today].results).toHaveLength(2);
});
