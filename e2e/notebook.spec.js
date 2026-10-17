import { test, expect } from "@playwright/test";
import { dictionaryRoutes, fulfillDictionary } from "./fixtures/dictionary.js";

const KEY = "dictationNotebook:guest";
async function seed(page, notes) {
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
  }, { key: KEY, value: notes });
}
async function enter(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /生词本.*听写与阅读/ }).click();
}
async function openBook(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /阅读.*读自己的书/ }).click();
  await page.locator("#reading-file").setInputFiles({ name: "test.md", mimeType: "text/markdown", buffer: Buffer.from("# Reading\n\nChildren read books.") });
  await expect(page.locator("#reader-next")).toBeEnabled();
  await page.locator("#reader-tab-dictionary").click();
  await page.locator("#dictionary-query").fill("children");
  await page.locator("#dictionary-query").press("Enter");
  await expect(page.locator("#dictionary-definition")).toContainText("儿童");
}

test("阅读收藏按原形去重、记录书名，刷新后在生词本展开完整注释", async ({ page }) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await dictionaryRoutes(page);
  await openBook(page);
  await page.locator("#dictionary-save").click();
  await expect(page.locator("#dictionary-save")).toBeDisabled();
  // 存盘形状从裸数组升级到 v2：词在 notes 里
  const notes = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).notes, KEY);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ word: "child", source: { type: "reading", title: "test", query: "children" } });
  expect(notes[0].meaning).toContain("儿童");
  await page.locator("#dictionary-query").fill("child");
  await page.locator("#dictionary-query").press("Enter");
  await expect(page.locator("#dictionary-save")).toHaveText("已加入生词本");
  await page.locator("#dictionary-query").fill("unknownword");
  await page.locator("#dictionary-query").press("Enter");
  await expect(page.locator("#dictionary-save")).toBeHidden();
  await enter(page);
  const row = page.locator(".note-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".note-source")).toContainText("阅读 · test · 原文：children");
  await expect(row.locator(".note-meaning")).toContainText("儿童");
  await expect(row.locator(".note-full-definition")).toBeHidden();
  await row.getByRole("button", { name: "查看全部注释" }).click();
  await expect(row.locator(".note-full-definition")).toContainText("这个孩子读一本书。");
  await row.getByRole("button", { name: "收起全部注释" }).click();
  await expect(row.locator(".note-full-definition")).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: /生词本.*听写与阅读/ }).click();
  await expect(page.locator(".note-row")).toHaveCount(1);
  await expect(page.locator(".note-meaning")).toContainText("儿童");
  expect(errors).toEqual([]);
});

test("旧生词使用柯林斯摘要，完整注释包含所有义项与例句，并保留掌握程度", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await dictionaryRoutes(page);
  await seed(page, [{ word: "book", meaning: "原来的简略释义", at: 9, level: 1 }]);
  await enter(page);
  const row = page.locator(".note-row");
  await expect(row.locator(".note-meaning")).toHaveText("书；a written work.");
  await expect(row.locator(".note-example")).toHaveText("I chose a new book.");
  await expect(row.locator(".note-full-definition article")).toHaveCount(0);
  await row.getByRole("button", { name: "查看全部注释" }).click();
  await expect(row.locator(".note-full-definition .C1_explanation_item")).toHaveCount(2);
  await expect(row.locator(".note-full-definition .C1_sentence_en")).toHaveCount(2);
  await expect(row.locator(".note-full-definition")).toContainText("我们预订一个房间。");
  await expect(row.locator(".note-full-definition script, .note-full-definition img")).toHaveCount(0);
  expect(await page.evaluate(() => window.dictionaryAttack)).toBeUndefined();
  await row.getByRole("button", { name: "记住了", exact: true }).click();
  await expect(row.getByRole("button", { name: "记住了", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".note-full-definition")).toBeVisible();
  await page.getByRole("searchbox", { name: "在生词本里搜索" }).fill("书");
  await expect(row).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  expect(stored.version).toBe(2);
  expect(stored.notes).toEqual([{ word: "book", meaning: "原来的简略释义", at: 9, level: 2 }]);
});

test("词库加载失败保留旧释义，可重试；未收录的词也不丢失", async ({ page }) => {
  let available = false;
  await page.route("**/dictionaries/collins/**", (route) => available ? fulfillDictionary(route) : route.fulfill({ status: 503, body: "temporarily unavailable" }));
  await seed(page, [{ word: "book", meaning: "保存的释义", at: 9 }, { word: "unknownword", meaning: "手动释义", at: 8 }]);
  await enter(page);
  const row = page.locator(".note-row").filter({ has: page.locator(".note-word", { hasText: /^book$/ }) });
  await expect(row).toContainText("柯林斯暂时无法加载");
  await expect(row.locator(".note-meaning")).toHaveText("保存的释义");
  available = true;
  await row.getByRole("button", { name: "重新加载柯林斯" }).click();
  await expect(row.locator(".note-meaning")).toHaveText("书；a written work.");
  const missing = page.locator(".note-row").filter({ has: page.locator(".note-word", { hasText: /^unknownword$/ }) });
  await missing.getByRole("button", { name: "重新加载柯林斯" }).click();
  await expect(missing).toContainText("柯林斯未收录");
  await expect(missing.locator(".note-meaning")).toHaveText("手动释义");
  await expect(missing.getByRole("button", { name: "查看全部注释" })).toBeDisabled();
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".note-row")).toHaveCount(1);
});

test("收藏遇到存储错误不会显示已收藏，恢复存储后可以重试", async ({ page }) => {
  await dictionaryRoutes(page);
  await openBook(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Storage is full", "QuotaExceededError");
      original.call(this, name, value);
    };
    window.restoreNotebookStorage = () => { Storage.prototype.setItem = original; };
  }, KEY);
  await page.locator("#dictionary-save").click();
  await expect(page.locator(".dictionary-save-status")).toContainText("未能保存");
  await expect(page.locator("#dictionary-save")).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await page.evaluate(() => window.restoreNotebookStorage());
  await page.locator("#dictionary-save").click();
  await expect(page.locator("#dictionary-save")).toHaveText("已加入生词本");
});
