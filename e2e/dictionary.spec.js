import { test, expect } from "@playwright/test";
import { dictionaryRoutes, fulfillDictionary } from "./fixtures/dictionary.js";
import { dictionaryShard } from "../src/reading/dictionary-model.js";

async function enter(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^词典/ }).click();
  await expect(page.locator("#lexicon-query")).toBeFocused();
  await expect(page.locator(".crumb-current")).toHaveText("词典");
}
async function search(page, word) {
  await page.locator("#lexicon-query").fill(word);
  await page.locator("#lexicon-query").press("Enter");
}

for (const width of [1280, 390]) {
  test(`首页词典查询完整注释、安全渲染、收藏并持久保存（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await dictionaryRoutes(page);
    await enter(page);
    await search(page, "books");
    await expect(page.locator("#lexicon-status")).toContainText("books → book");
    const definition = page.locator("#lexicon-definition");
    await expect(definition).toContainText("书；a written work.");
    await expect(definition).toContainText("预订；to reserve a place.");
    await expect(definition).toContainText("我们预订一个房间。");
    await expect(definition.locator("script, img")).toHaveCount(0);
    expect(await page.evaluate(() => window.dictionaryAttack)).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#lexicon-save").click();
    await expect(page.locator("#lexicon-save")).toHaveText("已加入生词本");
    await expect(page.locator("#lexicon-save")).toBeDisabled();
    await search(page, "book");
    await expect(page.locator("#lexicon-save")).toBeDisabled();
    await page.locator("#lexicon-notebook").click();
    await expect(page.locator(".note-row")).toHaveCount(1);
    await expect(page.locator(".note-word")).toHaveText("book");
    await expect(page.locator(".note-meaning")).toContainText("书");
    await page.reload();
    await page.getByRole("button", { name: /生词本.*听写与阅读/ }).click();
    await expect(page.locator(".note-word")).toHaveText("book");
    expect(errors).toEqual([]);
  });
}

test("未收录和无效输入清除旧释义，不提供收藏", async ({ page }) => {
  await dictionaryRoutes(page);
  await enter(page);
  await search(page, "children");
  await expect(page.locator("#lexicon-status")).toContainText("children → child");
  await search(page, "unknownword");
  await expect(page.locator("#lexicon-status")).toContainText("未收录");
  await expect(page.locator("#lexicon-definition")).toBeEmpty();
  await expect(page.locator("#lexicon-save")).toBeHidden();
  await search(page, "中文");
  await expect(page.locator("#lexicon-status")).toContainText("请输入有效的英文");
});

test("词库加载失败可重试，已收藏单词保留掌握程度", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dictationNotebook:guest",
    JSON.stringify([{ word: "book", meaning: "已有释义", at: 9, level: 2 }])));
  let failed = true;
  await page.route("**/dictionaries/collins/**", (route) => failed
    ? route.fulfill({ status: 503, body: "unavailable" }) : fulfillDictionary(route));
  await enter(page);
  await search(page, "book");
  await expect(page.locator("#lexicon-status")).toContainText("重新查询");
  await expect(page.locator("#lexicon-save")).toBeHidden();
  failed = false;
  await search(page, "book");
  await expect(page.locator("#lexicon-definition")).toContainText("预订");
  await expect(page.locator("#lexicon-save")).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dictationNotebook:guest"))))
    .toEqual([{ word: "book", meaning: "已有释义", at: 9, level: 2 }]);
});

test("连续查询时较早的慢响应不会覆盖新结果", async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let markRequested;
  const requested = new Promise((resolve) => { markRequested = resolve; });
  await page.route("**/dictionaries/collins/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith(`/${dictionaryShard("book")}.json`)) {
      markRequested();
      await pending;
    }
    return fulfillDictionary(route);
  });
  await enter(page);
  await search(page, "book");
  await requested;
  await search(page, "library");
  await expect(page.locator("#lexicon-definition")).toContainText("图书馆");
  release();
  await expect(page.locator("#lexicon-query")).toHaveValue("library");
  await expect(page.locator("#lexicon-definition")).toContainText("图书馆");
  await page.locator("#lexicon-save").click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dictationNotebook:guest")).notes[0].word)).toBe("library");
});
