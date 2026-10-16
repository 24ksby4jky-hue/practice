import { test, expect } from "@playwright/test";

const TEST_KEY = "sk-browser-test-not-a-real-key";
const STORAGE_KEY = "sentenceExpansion:guest";
const envelope = (content) => ({ choices: [{ message: { content }, finish_reason: "stop" }] });

const CLAIM = "Schools should teach practical skills.";
const ARGUMENTS = {
  cause: "This is because employers need ready skills.",
  example: "For instance, vocational schools place graduates quickly."
};

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
// 假接口按 user 消息里的 task 字段分派。三个任务各返回一种形状，
// 内容都从请求里派生 —— 这样测试验到的是「送进去的是什么」，而不只是「有没有返回」。
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
    let content = result?.content;
    if (content === undefined) {
      if (body.messages[0].role === "user") content = "OK";      // 连接测试
      else {
        const data = JSON.parse(body.messages[1].content);
        if (data.task === "claim") content = JSON.stringify({ optimized: data.studentSentence.replace(/^Schools should/, "Schools ought to") });
        else if (data.task === "argument") content = JSON.stringify({ optimized: `${data.studentArgument} [${data.method.id}]` });
        else content = JSON.stringify({ paragraph: data.parts.map((part) => part.text).join(" ") });
      }
    }
    await route.fulfill({ status: result?.status || 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify(result?.body || envelope(content)) }).catch(() => {});
  });
  return requests;
}

const claimEditor = (page) => page.locator('[data-block-key="claim"] textarea');
const claimOptimized = (page) => page.locator('[data-block-key="claim"] .exp-optimized-text');
const argBlock = (page, index) => page.locator("#exp-args .exp-block").nth(index);
// 连接测试只有一条 user 消息，没有第二个消息可解 —— 按任务名取的时候要跳过它。
const requestFor = (requests, task) => requests
  .map((body) => (body.messages[1] ? JSON.parse(body.messages[1].content) : null))
  .find((data) => data?.task === task);

async function openMethod(page, method) {
  await page.locator(".exp-add-arg summary").click();
  await page.locator(`#exp-method-${method}`).click();
}
async function addArgument(page, index, method, text) {
  await openMethod(page, method);
  const block = argBlock(page, index);
  await block.locator("textarea").fill(text);
  await block.locator('[data-pick="text"]').check();
}

test("12 个主题各显示 30 句基础论点，进入后基础论点只读展示", async ({ page }) => {
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
    // 基础论点只读展示在顶部，下面那个框是留给学生自己改写的
    await expect(page.locator(".exp-core-sentence")).not.toBeEmpty();
    await expect(page.locator(".exp-eyebrow")).toContainText("不可修改");
    await expect(page.locator(".exp-practice .exp-filter-bar")).toContainText(topic.name);
    await expect(claimEditor(page)).toHaveValue("");
    await page.locator("#exp-change-exercise").click();
  }
  // 难度档已经取消了，只剩主题
  await expect(page.locator("#exp-level")).toHaveCount(0);
});

test("丰富论点：改写、AI 优化只升级表达、原句保留；再次优化覆盖旧结果", async ({ page }) => {
  const requests = await mockApi(page);
  await enter(page);
  await connect(page);
  await page.locator("#exp-start-campus-books").click();
  const base = (await page.locator(".exp-core-sentence").innerText()).trim();

  await claimEditor(page).fill(CLAIM);
  await page.locator('[data-optimize="claim"]').click();
  await expect(claimOptimized(page)).toHaveText("Schools ought to teach practical skills.");
  // 框里的字一个都没被动过
  await expect(claimEditor(page)).toHaveValue(CLAIM);

  const sent = JSON.parse(requests
    .find((body) => body.messages[0].role === "system" && JSON.parse(body.messages[1].content).task === "claim")
    .messages[1].content);
  expect(sent.claim).toBe(base);
  expect(sent.studentSentence).toBe(CLAIM);

  // 改了框里的字再按一次，新结果盖掉旧结果
  await claimEditor(page).fill("Schools should deliver practical instruction.");
  await page.locator('[data-optimize="claim"]').click();
  await expect(claimOptimized(page)).toHaveText("Schools ought to deliver practical instruction.");
  await expect(page.locator('[data-block-key="claim"] .exp-optimized-text')).toHaveCount(1);

  // 原句和优化版各有自己的勾，可以同时勾上
  await page.locator('[data-block-key="claim"] [data-pick="text"]').check();
  await page.locator('[data-block-key="claim"] [data-pick="optimized"]').check();
  await expect(page.locator('[data-block-key="claim"] input:checked')).toHaveCount(2);
});

test("添加论证：同一方法可重复，多块各自独立优化、可移除", async ({ page }) => {
  const requests = await mockApi(page);
  await enter(page);
  await connect(page);
  await page.locator("#exp-start-campus-books").click();

  // 七种方法都能选，菜单里各带方法说明与常用衔接词
  await page.locator(".exp-add-arg summary").click();
  await expect(page.locator(".exp-method")).toHaveCount(7);
  await expect(page.locator(".exp-method-list")).toContainText("This is because");
  await page.locator("#exp-method-cause").click();
  await expect(page.locator(".exp-add-arg")).not.toHaveAttribute("open", "");
  await expect(page.locator("#exp-arg-count")).toContainText("已添加 1 块");

  // 同一种方法可以再加一块
  await openMethod(page, "cause");
  await expect(page.locator("#exp-arg-count")).toContainText("已添加 2 块");
  await expect(argBlock(page, 0)).toContainText("因果论证");
  await expect(argBlock(page, 1)).toContainText("因果论证");

  // 两块各自独立优化，互不影响
  await argBlock(page, 0).locator("textarea").fill(ARGUMENTS.cause);
  await argBlock(page, 1).locator("textarea").fill("A second cause written separately.");
  await argBlock(page, 0).locator('[data-optimize]').click();
  await expect(argBlock(page, 0).locator(".exp-optimized-text")).toHaveText(`${ARGUMENTS.cause} [cause]`);
  await expect(argBlock(page, 1).locator(".exp-optimized-text")).toHaveCount(0);
  await expect(argBlock(page, 1).locator("textarea")).toHaveValue("A second cause written separately.");

  // 优化请求里带上了这一块选的方法
  const argumentRequest = requestFor(requests, "argument");
  expect(argumentRequest.method.id).toBe("cause");
  expect(argumentRequest.method.connectives).toContain("As a result");

  // 移除只影响那一块
  await argBlock(page, 0).getByRole("button", { name: "移除" }).click();
  await expect(page.locator("#exp-args .exp-block")).toHaveCount(1);
  await expect(argBlock(page, 0).locator("textarea")).toHaveValue("A second cause written separately.");
  await expect(page.locator("#exp-arg-count")).toContainText("已添加 1 块");
});

test("融合门槛：需一版论点 + 两块不同论证；空块不可勾也不计入", async ({ page }) => {
  await mockApi(page);
  await enter(page);
  await connect(page);
  await page.locator("#exp-start-campus-books").click();

  await expect(page.locator("#exp-fuse")).toBeDisabled();
  await expect(page.locator("#exp-fuse-hint")).toContainText("论点");

  await claimEditor(page).fill(CLAIM);
  await page.locator('[data-block-key="claim"] [data-pick="text"]').check();
  await expect(page.locator("#exp-fuse-hint")).toContainText("2 个不同的论证块");
  await expect(page.locator("#exp-fuse")).toBeDisabled();

  await addArgument(page, 0, "cause", ARGUMENTS.cause);
  await expect(page.locator("#exp-fuse-hint")).toContainText("1 个不同的论证块");
  await expect(page.locator("#exp-fuse")).toBeDisabled();

  await addArgument(page, 1, "example", ARGUMENTS.example);
  await expect(page.locator("#exp-fuse")).toBeEnabled();
  await expect(page.locator("#exp-fuse-hint")).toContainText("将论点与 2 个论证块");

  // 同一块勾了原句又勾优化版，仍然只算一块
  await argBlock(page, 0).locator('[data-optimize]').click();
  await expect(argBlock(page, 0).locator(".exp-optimized-text")).toBeVisible();
  await argBlock(page, 0).locator('[data-pick="optimized"]').check();
  await expect(page.locator("#exp-fuse")).toBeEnabled();
  await argBlock(page, 1).locator('[data-pick="text"]').uncheck();
  await expect(page.locator("#exp-fuse")).toBeDisabled();
  await expect(page.locator("#exp-fuse-hint")).toContainText("1 个不同的论证块");

  // 空的写作块连勾都不给，并且把原因写出来
  await openMethod(page, "contrast");
  await expect(argBlock(page, 2).locator(".exp-choices")).toContainText("先写下内容");
  await expect(argBlock(page, 2).locator("input[type=checkbox]")).toHaveCount(0);
  await expect(page.locator("#exp-fuse")).toBeDisabled();

  // 清空一块已经勾上的，那个勾会自己撤掉
  await argBlock(page, 0).locator("textarea").fill("");
  await expect(argBlock(page, 0).locator('[data-pick="text"]')).toHaveCount(0);
  await expect(argBlock(page, 0).locator("input[type=checkbox]")).toHaveCount(1);
});

test("融合成功：按勾选顺序成段、练习结束、记录只存新格式、Key 不落盘", async ({ page }) => {
  const exceptions = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  const requests = await mockApi(page);
  await enter(page);
  await expect(page.locator("#exp-api-key")).toHaveValue("");
  await connect(page);
  expect(requests[0].model).toBe("deepseek-flash");
  await page.locator("#exp-start-campus-books").click();

  await claimEditor(page).fill(CLAIM);
  await page.locator('[data-block-key="claim"] [data-pick="text"]').check();
  await addArgument(page, 0, "cause", ARGUMENTS.cause);
  await addArgument(page, 1, "example", ARGUMENTS.example);

  await page.locator("#exp-fuse").click();
  const paragraph = [CLAIM, ARGUMENTS.cause, ARGUMENTS.example].join(" ");
  await expect(page.locator(".exp-paragraph")).toHaveText(paragraph);

  // 送进模型的顺序：先论点，再按添加顺序
  const fusion = requestFor(requests, "fusion");
  expect(fusion.parts.map((part) => part.text)).toEqual([CLAIM, ARGUMENTS.cause, ARGUMENTS.example]);

  const storage = await page.evaluate((key) => ({ all: JSON.stringify({ ...localStorage, ...sessionStorage }), value: JSON.parse(localStorage.getItem(key)) }), STORAGE_KEY);
  expect(storage.all).not.toContain(TEST_KEY);
  expect(storage.value.version).toBe(2);
  expect(storage.value.records).toHaveLength(1);
  // 记录留着完整过程：论点、两条论证的原稿与所用方法、最后的段落
  expect(storage.value.records[0].fusion).toBe(paragraph);
  expect(storage.value.records[0].claimEdit.text).toBe(CLAIM);
  expect(storage.value.records[0].arguments.map((block) => block.method)).toEqual(["cause", "example"]);
  // 旧格式的字段一个都不该留下
  expect(storage.value.records[0].steps).toBeUndefined();
  expect(storage.value.records[0].level).toBeUndefined();

  await page.locator("#exp-tab-records").click();
  await page.locator(".exp-record > summary").click();
  await expect(page.locator(".exp-record .exp-paragraph")).toHaveText(paragraph);
  await expect(page.locator(".exp-record")).toContainText("因果论证");
  expect(exceptions).toEqual([]);
});

test("失败保留已写内容、可再按一次；刷新恢复草稿但不恢复 Key", async ({ page }) => {
  let response;
  await mockApi(page, () => response);
  await enter(page);
  await connect(page);
  await page.locator("#exp-start-campus-books").click();
  await claimEditor(page).fill(CLAIM);
  await openMethod(page, "cause");
  await argBlock(page, 0).locator("textarea").fill(ARGUMENTS.cause);

  response = { status: 429 };
  await page.locator('[data-optimize="claim"]').click();
  await expect(page.getByRole("alert")).toContainText("频繁");
  // 失败之后原稿还在，错误也落在这一块里
  await expect(claimEditor(page)).toHaveValue(CLAIM);
  await expect(page.locator('[data-block-key="claim"] .exp-block-status')).toContainText("频繁");
  await expect(argBlock(page, 0).locator("textarea")).toHaveValue(ARGUMENTS.cause);

  // 再按一次就能成功，错误消失
  response = undefined;
  await page.locator('[data-optimize="claim"]').click();
  await expect(claimOptimized(page)).toHaveText("Schools ought to teach practical skills.");
  await expect(page.locator('[data-block-key="claim"] .exp-block-status')).toHaveText("");

  // 融合失败同样保留内容
  await page.locator('[data-block-key="claim"] [data-pick="text"]').check();
  await argBlock(page, 0).locator('[data-pick="text"]').check();
  await addArgument(page, 1, "example", ARGUMENTS.example);
  response = { status: 503 };
  await page.locator("#exp-fuse").click();
  await expect(page.getByRole("alert")).toContainText("暂时");
  await expect(claimEditor(page)).toHaveValue(CLAIM);
  await expect(argBlock(page, 1).locator("textarea")).toHaveValue(ARGUMENTS.example);

  await page.reload();
  await page.getByRole("button", { name: /基础练习/ }).click();
  await page.getByRole("button", { name: /句子扩写练习/ }).click();
  await expect(page.locator("#exp-api-key")).toHaveValue("");
  await expect(page.locator(".exp-connection")).toHaveText("AI 未连接");
  await page.locator("#exp-offline").click();
  await expect(claimEditor(page)).toHaveValue(CLAIM);
  await expect(argBlock(page, 0).locator("textarea")).toHaveValue(ARGUMENTS.cause);
  await expect(page.locator("#exp-args .exp-block")).toHaveCount(2);
});

test("取消、离开页面与窄屏：不套用迟到的回答，也不横向溢出", async ({ page }) => {
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
  await claimEditor(page).fill(CLAIM);
  await page.locator('[data-optimize="claim"]').click();
  await expect.poll(() => waiting).toBe(true);
  // 优化期间所有输入框都锁上，快照和返回值不会错位
  await expect(claimEditor(page)).toHaveAttribute("readonly", "");
  await page.locator("#exp-cancel-ai").click();
  await expect(claimEditor(page)).not.toHaveAttribute("readonly");
  release();
  await expect(claimOptimized(page)).toHaveCount(0);
  await expect(claimEditor(page)).toHaveValue(CLAIM);

  // 离开这一页也会作废在途请求
  waiting = false;
  await page.locator('[data-optimize="claim"]').click();
  await expect.poll(() => waiting).toBe(true);
  await page.getByRole("button", { name: "基础练习", exact: true }).click();
  release();
  await page.getByRole("button", { name: /句子扩写练习/ }).click();
  await expect(claimEditor(page)).toHaveValue(CLAIM);
  await expect(claimOptimized(page)).toHaveCount(0);
  await expect(page.locator('[data-optimize="claim"]')).toBeEnabled();

  // 刷新之后 Key 没了（它只存内存），草稿还在；窄屏也不横向溢出
  await page.reload();
  await page.getByRole("button", { name: /基础练习/ }).click();
  await page.getByRole("button", { name: /句子扩写练习/ }).click();
  await page.locator("#exp-offline").click();
  await expect(claimEditor(page)).toHaveValue(CLAIM);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 没连上就点 AI：把人带到设置并聚焦 Key，而不是静默失败
  await page.locator('[data-optimize="claim"]').click();
  await expect(page.locator("#exp-api-key")).toBeVisible();
  await expect(page.locator("#exp-api-key")).toBeFocused();
  await expect(claimEditor(page)).toHaveValue(CLAIM);
});
