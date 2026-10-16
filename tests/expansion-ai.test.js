import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, newSession } from "../src/expansion/expansion-model.js";
import { exerciseById } from "../src/expansion/exercises.js";
import { requestCompletion, testConnection, requestCoach, coachingMessages } from "../src/expansion/ai-client.js";

const config = { ...DEFAULT_CONFIG, apiKey: "sk-test-only" };
const session = newSession("campus-books", "basic", "test", 1000);
const task = exerciseById(session.exerciseId);
const completion = (content, finish_reason = "stop") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }),
  { status: 200, headers: { "Content-Type": "application/json" } });

test("连接测试使用默认模型，只在 Authorization 中携带 Key，不产生重试", async () => {
  let count = 0;
  await testConnection(config, { fetchImpl: async (url, options) => {
    count += 1;
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer sk-test-only");
    assert.equal(options.credentials, "omit");
    assert.ok(!options.body.includes(config.apiKey));
    const body = JSON.parse(options.body);
    assert.equal(body.model, "deepseek-flash");
    assert.equal(body.thinking.type, "disabled");
    assert.equal(body.response_format, undefined);
    return completion("OK");
  } });
  assert.equal(count, 1);
});

test("提示不索要完整答案，检查请求只包含本题当前及以前的步骤", () => {
  const hint = coachingMessages("hint", task, session);
  assert.match(hint[0].content, /不能写出完整/);
  const messages = coachingMessages("feedback", task, session);
  const data = JSON.parse(messages[1].content);
  assert.equal(data.step, 1);
  assert.equal(data.goal, task.steps[0].goal);
  assert.deepEqual(data.previous, []);
  assert.ok(!messages[1].content.includes("apiKey"));
  assert.ok(!messages[1].content.includes(task.steps[2].reference));
});

test("提示和反馈经校验后返回，模型输出中的 HTML 保持为文本", async () => {
  const hint = await requestCoach(config, "hint", task, session, { fetchImpl: async () => completion('{"hint":"可以用 about + 主题。"}') });
  assert.equal(hint, "可以用 about + 主题。");
  const feedback = { status: "<img src=x onerror=alert(1)>", needs_revision: false, corrections: [],
    suggestion: "Students read science books.", explanation: "保留核心意思。" };
  assert.deepEqual(await requestCoach(config, "feedback", task, session, { fetchImpl: async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).response_format, { type: "json_object" });
    return completion(JSON.stringify(feedback));
  } }), feedback);
});

test("自定义兼容端点不附加 DeepSeek 专有参数", async () => {
  await testConnection({ ...config, baseUrl: "https://proxy.example/v1" }, { fetchImpl: async (url, options) => {
    assert.equal(url, "https://proxy.example/v1/chat/completions");
    assert.equal(JSON.parse(options.body).thinking, undefined);
    return completion("OK");
  } });
});

test("鉴权、余额、限流和服务错误不回显响应中的敏感信息且不自动重试", async () => {
  for (const [status, expected] of [[401, /Key/], [402, /余额/], [404, /模型/], [429, /频繁/], [503, /暂时/]]) {
    let count = 0;
    await assert.rejects(testConnection(config, { fetchImpl: async () => {
      count += 1;
      return new Response("secret-provider-echo", { status });
    } }), (error) => expected.test(error.message) && !error.message.includes("secret-provider-echo"));
    assert.equal(count, 1);
  }
});

test("网络、空输出、截断、坏 JSON 和不完整反馈均可恢复地报错", async () => {
  await assert.rejects(testConnection(config, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), /跨域/);
  for (const response of [completion(""), completion("{}", "length"), completion("not json"), new Response("<html>wrong endpoint</html>")]) {
    await assert.rejects(requestCompletion(config, [], { fetchImpl: async () => response }));
  }
  await assert.rejects(requestCoach(config, "feedback", task, session, { fetchImpl: async () => completion("{}") }), /不完整/);
  await assert.rejects(requestCoach(config, "hint", task, session, { fetchImpl: async () => completion('{"hint":4}') }), /提示/);
});

const abortable = async (url, options) => new Promise((resolve, reject) => {
  const abort = () => reject(new DOMException("Aborted", "AbortError"));
  if (options.signal.aborted) abort();
  else options.signal.addEventListener("abort", abort, { once: true });
});

test("超时和用户取消可区分，不把取消显示成服务错误", async () => {
  await assert.rejects(testConnection(config, { fetchImpl: abortable, timeoutMs: 10 }), /超时/);
  const controller = new AbortController();
  const pending = testConnection(config, { fetchImpl: abortable, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
