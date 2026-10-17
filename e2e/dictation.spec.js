import { test, expect } from "@playwright/test";
import { dictionaryRoutes, fulfillDictionary } from "./fixtures/dictionary.js";
import { dictionaryShard } from "../src/reading/dictionary-model.js";

async function enter(page) {
  await page.addInitScript(() => {
    window.spoken = [];
    Object.defineProperty(window, "speechSynthesis", { value: {
      cancel() {},
      speak(utterance) { window.spoken.push({ text: utterance.text, lang: utterance.lang }); }
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /基础练习/ }).click();
  await page.getByRole("button", { name: /单词听写.*8 个板块/ }).click();
  await page.locator(".unit-card").first().click();
  await expect(page.locator("#dict-progress")).toContainText("练习 1 / 20");
}

test("答题前不显示或请求注释，答对后显示柯林斯释义、双语例句并可展开全部注释", async ({ page }) => {
  const requests = [];
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/dictionaries/collins/")) requests.push(request.url()); });
  await dictionaryRoutes(page);
  await enter(page);
  await expect(page.locator("#dict-answer")).toBeHidden();
  expect(requests).toEqual([]);
  await page.keyboard.type("schedule");
  await expect(page.locator("#dict-answer .ok-label")).toHaveText("正确");
  await expect(page.locator(".dict-meaning")).toHaveText("日程；a plan of activities.");
  await expect(page.locator(".dict-collins-example")).toHaveText("The schedule has changed.");
  await expect(page.locator(".dict-example-translation")).toHaveText("日程已经改变。");
  await expect(page.locator("#dict-annotation-full")).toBeHidden();
  await page.locator("#dict-annotation-toggle").focus();
  await page.locator("#dict-annotation-toggle").press("Enter");
  await expect(page.locator("#dict-progress")).toContainText("练习 1 / 20");
  await expect(page.locator("#dict-annotation-full .C1_explanation_item")).toHaveCount(2);
  await expect(page.locator("#dict-annotation-full .C1_sentence_en")).toHaveCount(2);
  await expect(page.locator("#dict-annotation-full")).toContainText("我们安排一次会议。");
  await expect(page.locator("#dict-annotation-full script, #dict-annotation-full img")).toHaveCount(0);
  expect(await page.evaluate(() => window.dictionaryAttack)).toBeUndefined();
  await page.locator("#dict-annotation-toggle").click();
  await expect(page.locator("#dict-annotation-full")).toBeHidden();
  await page.locator("#dict-us").click();
  await page.locator("#dict-example").click();
  expect(await page.evaluate(() => window.spoken)).toContainEqual({ text: "The schedule has changed.", lang: "en-US" });
  await expect(page.locator("#dict-note")).toHaveCount(0);
  await page.locator("#dict-next").click();
  await expect(page.locator("#dict-progress")).toContainText("练习 2 / 20");
  await expect(page.locator("#dict-answer")).toBeHidden();
  expect(errors).toEqual([]);
});

test("看答案后收藏柯林斯摘要，保留听写来源和错误判定", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await dictionaryRoutes(page);
  await enter(page);
  await page.locator("#dict-reveal").click();
  await expect(page.locator("#dict-answer .bad-label")).toHaveText("错误");
  await expect(page.locator(".dict-meaning")).toHaveText("日程；a plan of activities.");
  await page.locator("#dict-annotation-toggle").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#dict-note").click();
  await expect(page.locator("#dict-progress")).toContainText("练习 2 / 20");
  const notes = await page.evaluate(() => JSON.parse(localStorage.getItem("dictationNotebook:guest")).notes);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ word: "schedule", meaning: "日程；a plan of activities." });
  await expect(page.locator("#dict-stats")).toContainText("0/20");
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await page.getByRole("button", { name: /生词本.*听写与阅读/ }).click();
  await expect(page.locator(".note-source")).toHaveText("校园生活 · 第 1 单元");
  await expect(page.locator(".note-meaning")).toHaveText("日程；a plan of activities.");
});

test("词库失败可重试，未收录时回退词表注释和例句，不阻塞下一词", async ({ page }) => {
  let available = false;
  await page.route("**/dictionaries/collins/**", (route) => {
    if (!available) return route.fulfill({ status: 503, body: "temporarily unavailable" });
    const filename = new URL(route.request().url()).pathname.split("/").pop();
    if (filename === `${dictionaryShard("library")}.json`) return route.fulfill({ json: {} });
    return fulfillDictionary(route);
  });
  await enter(page);
  await page.locator("#dict-reveal").click();
  await expect(page.locator(".dict-annotation-status")).toContainText("柯林斯暂时无法加载");
  await expect(page.locator(".dict-meaning")).toContainText("日程，时间表");
  await expect(page.locator(".dict-collins-example")).toHaveText("She checked the schedule before leaving for class.");
  await expect(page.locator("#dict-example")).toBeEnabled();
  available = true;
  await page.locator("#dict-annotation-retry").click();
  await expect(page.locator(".dict-meaning")).toHaveText("日程；a plan of activities.");
  await page.locator("#dict-next").click();
  await page.locator("#dict-reveal").click();
  await expect(page.locator(".dict-annotation-status")).toContainText("柯林斯未收录");
  await expect(page.locator(".dict-meaning")).toContainText("图书馆");
  await expect(page.locator(".dict-collins-example")).toHaveText("The library stays open until ten at night.");
  await expect(page.locator("#dict-annotation-toggle")).toBeHidden();
  await page.locator("#dict-next").click();
  await expect(page.locator("#dict-progress")).toContainText("练习 3 / 20");
});

test("快速切题后，上一题延迟的注释不会覆盖当前单词", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  await page.route("**/dictionaries/collins/**", async (route) => {
    const filename = new URL(route.request().url()).pathname.split("/").pop();
    if (filename === `${dictionaryShard("schedule")}.json`) { started(); await gate; }
    await fulfillDictionary(route);
  });
  await enter(page);
  try {
    await page.locator("#dict-reveal").click();
    await pending;
    await expect(page.locator(".dict-annotation-status")).toContainText("正在读取");
    await expect(page.locator("#dict-example")).toBeDisabled();
    await page.locator("#dict-next").click();
    await page.locator("#dict-reveal").click();
    await expect(page.locator(".dict-meaning")).toHaveText("图书馆；a place where books are kept.");
    release();
    await page.locator("#dict-annotation-toggle").click();
    await expect(page.locator("#dict-answer h2")).toHaveText("library");
    await expect(page.locator("#dict-annotation-full")).toContainText("图书馆欢迎读者。");
    await expect(page.locator("#dict-annotation-full")).not.toContainText("日程已经改变");
    await page.locator("#dict-back").click();
    await expect(page.locator("#dict-picker")).toBeVisible();
  } finally { release(); }
});
