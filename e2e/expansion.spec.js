import { test, expect } from "@playwright/test";

const TEST_KEY = "sk-browser-test-not-a-real-key";
const STORAGE_KEY = "sentenceExpansion:guest";
const envelope = (content) => ({ choices: [{ message: { content }, finish_reason: "stop" }] });
const feedback = { status: "已补充书的主题，保留了核心意思。", needs_revision: false,
  corrections: [], suggestion: "Students read books about science.", explanation: "about science 说明书籍的主题。" };

async function enter(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /基础练习/ }).click();
  await page.getByRole("button", { name: /句子扩写练习/ }).click();
}
async function connect(page) {
  await page.locator("#exp-api-key").fill(TEST_KEY);
  await page.locator("#exp-connect").click();
  await expect(page.locator(".exp-connection")).toContainText("已连接");
}
async function mockApi(page, custom) {
  const requests = [];
  await page.route("https://api.deepseek.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "POST" } });
    }
    const body = route.request().postDataJSON();
    requests.push(body);
    const result = custom ? await custom(body) : undefined;
    const content = result?.content ?? (body.messages[0].role === "user" ? "OK"
      : body.messages[0].content.includes("不能写出完整") ? JSON.stringify({ hint: "可以用 about 加上书的主题。" }) : JSON.stringify(feedback));
    await route.fulfill({ status: result?.status || 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify(result?.body || envelope(content)) }).catch(() => {});
  });
  return requests;
}

test("12 个雅思主题各显示 30 句，最后一题可进入扩写", async ({ page }) => {
  await enter(page);
  await page.locator("#exp-offline").click();
  const topics = await page.locator("#exp-topic option").evaluateAll((options) => options.map((option) => ({ id: option.value, name: option.textContent })));
  expect(topics).toHaveLength(12);
  for (const topic of topics) {
    await page.locator("#exp-topic").selectOption(topic.id);
    await expect(page.locator(".exp-exercise-row")).toHaveCount(30);
    await expect(page.locator(".exp-filter-bar")).toContainText("本主题 30 句");
    await expect(page.locator(".exp-question-number").last()).toHaveText("30 / 30");
    await page.locator(".exp-exercise-row").last().getByRole("button").click();
    await expect(page.locator("#exp-goal")).toContainText("第 1 步");
    await expect(page.locator(".exp-practice .exp-filter-bar")).toContainText(topic.name);
    await page.locator("#exp-change-exercise").click();
  }
});

test("三步扩写、AI 提示优化、主动采用和历史回顾，Key 不落盘", async ({ page }) => {
  const exceptions = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  const requests = await mockApi(page);
  await enter(page);
  await expect(page.locator("#exp-api-key")).toHaveValue("");
  await connect(page);
  expect(requests[0].model).toBe("deepseek-flash");
  await page.locator("#exp-start-campus-books").click();
  await page.locator("#exp-answer").fill("Students read science books.");
  expect(requests.length).toBe(1);
  await page.locator("#exp-ai-hint").click();
  await expect(page.locator(".exp-feedback")).toContainText("about");
  await expect(page.locator("#exp-answer")).toHaveValue("Students read science books.");
  await page.locator("#exp-ai-feedback").click();
  await expect(page.locator("#exp-adopt")).toBeVisible();
  await expect(page.locator("#exp-answer")).toHaveValue("Students read science books.");
  await page.locator("#exp-adopt").click();
  await expect(page.locator("#exp-answer")).toHaveValue(feedback.suggestion);
  await page.locator("#exp-next-step").click();
  await expect(page.locator("#exp-goal")).toContainText("第 2 步");
  await expect(page.locator("#exp-answer")).toHaveValue(feedback.suggestion);
  await page.locator("#exp-answer").fill("Students read books about science in the library.");
  await page.locator("#exp-next-step").click();
  await expect(page.locator("#exp-goal")).toContainText("第 3 步");
  const final = "Students read books about science in the library to learn about the natural world.";
  await page.locator("#exp-answer").fill(final);
  await page.locator("#exp-next-step").click();
  await expect(page.locator(".exp-final-sentence")).toHaveText(final);
  await page.locator("#exp-tab-records").click();
  await page.locator(".exp-record > summary").click();
  await expect(page.locator(".exp-record .exp-final-sentence")).toHaveText(final);
  const storage = await page.evaluate((key) => ({ all: JSON.stringify({ ...localStorage, ...sessionStorage }), value: JSON.parse(localStorage.getItem(key)) }), STORAGE_KEY);
  expect(storage.all).not.toContain(TEST_KEY);
  expect(storage.value.records).toHaveLength(1);
  expect(storage.value.records[0].steps[0].reviewedAnswer).toBe("Students read science books.");
  expect(requests).toHaveLength(3);
  expect(exceptions).toEqual([]);
});

test("鉴权失败、限流和坏响应保留原稿；AI 文本不能执行 HTML", async ({ page }) => {
  let response = { status: 401 };
  await mockApi(page, () => response);
  await enter(page);
  await page.locator("#exp-api-key").fill(TEST_KEY);
  await page.locator("#exp-connect").click();
  await expect(page.getByRole("alert")).toContainText("API Key");
  response = undefined;
  await connect(page);
  await page.locator("#exp-start-campus-books").click();
  const draft = "Students read history books.";
  await page.locator("#exp-answer").fill(draft);
  response = { status: 429 };
  await page.locator("#exp-ai-feedback").click();
  await expect(page.getByRole("alert")).toContainText("频繁");
  await expect(page.locator("#exp-answer")).toHaveValue(draft);
  response = { content: "{}" };
  await page.locator("#exp-ai-feedback").click();
  await expect(page.getByRole("alert")).toContainText("不完整");
  await expect(page.locator("#exp-answer")).toHaveValue(draft);
  response = { content: JSON.stringify({ ...feedback, status: '<img src=x onerror="window.aiAttack=true">' }) };
  await page.locator("#exp-ai-feedback").click();
  await expect(page.locator("#exp-adopt")).toBeVisible();
  await expect(page.locator(".exp-feedback")).toContainText("<img");
  await expect(page.locator(".exp-feedback img")).toHaveCount(0);
  expect(await page.evaluate(() => window.aiAttack)).toBeUndefined();
});

test("取消、离开页面与再次进入不会套用迟到的 AI 回答", async ({ page }) => {
  let release;
  let waiting = false;
  await mockApi(page, async (body) => {
    if (body.messages[0].role !== "user") {
      waiting = true;
      await new Promise((resolve) => { release = resolve; });
    }
  });
  await enter(page);
  await connect(page);
  await page.locator("#exp-start-campus-books").click();
  await page.locator("#exp-answer").fill("Students read books about art.");
  await page.locator("#exp-ai-feedback").click();
  await expect.poll(() => waiting).toBe(true);
  await page.locator("#exp-cancel-ai").click();
  await expect(page.locator("#exp-answer")).not.toHaveAttribute("readonly");
  release();
  await expect(page.locator("#exp-adopt")).toHaveCount(0);
  waiting = false;
  await page.locator("#exp-ai-feedback").click();
  await expect.poll(() => waiting).toBe(true);
  await page.getByRole("button", { name: "基础练习", exact: true }).click();
  release();
  await page.getByRole("button", { name: /句子扩写练习/ }).click();
  await expect(page.locator("#exp-answer")).toHaveValue("Students read books about art.");
  await expect(page.locator("#exp-adopt")).toHaveCount(0);
  await expect(page.locator("#exp-ai-feedback")).toBeEnabled();
});

test("刷新后恢复草稿但不恢复 Key；可独立练习，窄屏没有横向溢出", async ({ page }) => {
  const requests = await mockApi(page);
  await enter(page);
  await connect(page);
  await page.locator("#exp-start-campus-books").click();
  await page.locator("#exp-answer").fill("Students read books about art.");
  await page.locator("#exp-next-step").click();
  await page.reload();
  await page.getByRole("button", { name: /基础练习/ }).click();
  await page.getByRole("button", { name: /句子扩写练习/ }).click();
  await expect(page.locator("#exp-api-key")).toHaveValue("");
  await expect(page.locator(".exp-connection")).toHaveText("AI 未连接");
  await page.locator("#exp-offline").click();
  await expect(page.locator("#exp-answer")).toHaveValue("Students read books about art.");
  await expect(page.locator("#exp-goal")).toContainText("第 2 步");
  await page.locator("#exp-previous-step").click();
  await expect(page.locator("#exp-answer")).toHaveValue("Students read books about art.");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#exp-ai-feedback").click();
  await expect(page.locator("#exp-api-key")).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.locator("#exp-api-key").fill(TEST_KEY);
  await page.locator("#exp-clear-key").click();
  await expect(page.locator("#exp-api-key")).toHaveValue("");
  await expect(page.locator("#exp-answer")).toHaveValue("Students read books about art.");
});
