import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, newSession, addArgument, setClaimText, setArgumentText,
  toggleClaimCheck, toggleArgumentCheck, fusionPayload } from "../src/expansion/expansion-model.js";
import { exerciseById } from "../src/expansion/exercises.js";
import { methodById } from "../src/expansion/methods.js";
import { requestCompletion, testConnection, requestClaimOptimization, requestArgumentOptimization,
  requestFusion, claimOptimizationMessages, argumentOptimizationMessages, fusionMessages } from "../src/expansion/ai-client.js";

const config = { ...DEFAULT_CONFIG, apiKey: "sk-test-only" };
const task = exerciseById("campus-books");
const completion = (content, finish_reason = "stop") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }),
  { status: 200, headers: { "Content-Type": "application/json" } });

// 一份勾好了论点 + 两块论证的会话，用来验融合的顺序。
const prepared = () => {
  let session = setClaimText(newSession("campus-books", "test", 1000), "Schools should teach practical skills.", 2000);
  session = addArgument(session, "cause", "a1", 2100);
  session = addArgument(session, "example", "a2", 2200);
  session = setArgumentText(session, "a1", "This is because employers need ready skills.", 2300);
  session = setArgumentText(session, "a2", "For instance, vocational schools place graduates quickly.", 2400);
  session = toggleClaimCheck(session, "text", 2500);
  session = toggleArgumentCheck(session, "a1", "text", 2500);
  session = toggleArgumentCheck(session, "a2", "text", 2500);
  return session;
};

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

test("优化论点的提示禁止加入原因、例子和对比，用户消息含原句与基础论点", () => {
  const messages = claimOptimizationMessages(task, "Schools should teach practical skills.");
  assert.match(messages[0].content, /禁止加入原因、例子、对比/);
  assert.match(messages[0].content, /词汇与句法层面/);
  const data = JSON.parse(messages[1].content);
  assert.equal(data.task, "claim");
  assert.equal(data.claim, task.claim);
  assert.equal(data.meaning, task.meaning);
  assert.equal(data.studentSentence, "Schools should teach practical skills.");
  assert.ok(!messages[1].content.includes("apiKey"));
});

test("优化论证的提示带上所选方法与衔接词，并要求保留立场", () => {
  const method = methodById("example");
  const messages = argumentOptimizationMessages(task, method, "For instance, some schools do this.");
  assert.match(messages[0].content, /保留学生的立场/);
  assert.match(messages[0].content, /不得编造具体数据/);
  assert.match(messages[0].content, /回到学生自己的立场/);
  const data = JSON.parse(messages[1].content);
  assert.equal(data.task, "argument");
  assert.equal(data.method.id, "example");
  assert.deepEqual(data.method.connectives, method.connectives);
  assert.equal(data.claim, task.claim);
  assert.equal(data.studentArgument, "For instance, some schools do this.");
});

test("融合提示要求按给定顺序、不得新增观点，顺序来自 fusionPayload", () => {
  const session = prepared();
  const parts = fusionPayload(session);
  const messages = fusionMessages(task, parts);
  assert.match(messages[0].content, /顺序必须严格保持不变/);
  assert.match(messages[0].content, /不得增加新的观点/);
  assert.match(messages[0].content, /只输出一个英文段落/);
  const data = JSON.parse(messages[1].content);
  assert.equal(data.task, "fusion");
  assert.deepEqual(data.parts.map((part) => part.role), ["claim", "argument", "argument"]);
  assert.deepEqual(data.parts.map((part) => part.text), parts.map((part) => part.text));
  // 论点在前，论证按添加顺序
  assert.equal(data.parts[0].text, "Schools should teach practical skills.");
  assert.equal(data.parts[1].method, "cause");
  assert.equal(data.parts[2].method, "example");
});

test("优化与融合的返回值经校验后返回，模型输出中的 HTML 保持为文本", async () => {
  const refined = await requestClaimOptimization(config, task, "Schools should teach practical skills.",
    { fetchImpl: async (url, options) => {
      assert.deepEqual(JSON.parse(options.body).response_format, { type: "json_object" });
      return completion('{"optimized":"Schools should prioritise practical instruction."}');
    } });
  assert.equal(refined, "Schools should prioritise practical instruction.");

  const trimmed = await requestArgumentOptimization(config, task, methodById("cause"), "This is because it helps.",
    { fetchImpl: async () => completion('{"optimized":"  This is because it helps.  "}') });
  assert.equal(trimmed, "This is because it helps.");

  const paragraph = await requestFusion(config, task, fusionPayload(prepared()),
    { fetchImpl: async () => completion('{"paragraph":"<img src=x onerror=alert(1)>"}') });
  assert.equal(paragraph, "<img src=x onerror=alert(1)>");
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

test("网络、空输出、截断、坏 JSON 和残缺返回值均可恢复地报错", async () => {
  await assert.rejects(testConnection(config, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), /跨域/);
  for (const response of [completion(""), completion("{}", "length"), completion("not json"), new Response("<html>wrong endpoint</html>")]) {
    await assert.rejects(requestCompletion(config, [], { fetchImpl: async () => response }));
  }
  for (const payload of ["{}", '{"optimized":4}', '{"optimized":""}', '{"optimized":"只有中文"}']) {
    await assert.rejects(requestClaimOptimization(config, task, "Schools should do more.",
      { fetchImpl: async () => completion(payload) }), /格式不完整/);
  }
  for (const payload of ["{}", '{"paragraph":""}', '{"paragraph":"只有中文"}']) {
    await assert.rejects(requestFusion(config, task, [], { fetchImpl: async () => completion(payload) }),
      /格式不完整/);
  }
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
