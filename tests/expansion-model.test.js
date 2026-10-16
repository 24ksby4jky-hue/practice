import test from "node:test";
import assert from "node:assert/strict";
import { EXERCISES, TOPICS, exerciseById } from "../src/expansion/exercises.js";
import { EXERCISES as LEGACY } from "../src/expansion/legacy-exercises.js";
import { DEFAULT_CONFIG, newSession, advanceSession, previousStep, normalizeConfig,
  readStore, cleanStore, answerError, parseFeedback, recordCompleted, RECORD_LIMIT } from "../src/expansion/expansion-model.js";

const fresh = () => newSession("campus-books", "basic", "session-1", 1000);
const feedback = { status: "已完成细节补充。", needs_revision: false, corrections: [],
  suggestion: "Students read books about science.", explanation: "about 引出书的主题。" };

test("12 个雅思主题各有 30 个不同的基础句，每句都有三步扩写", () => {
  assert.equal(TOPICS.length, 12);
  assert.equal(EXERCISES.length, 360);
  assert.equal(new Set(EXERCISES.map((item) => item.id)).size, 360);
  assert.equal(new Set(EXERCISES.map((item) => item.core.toLowerCase())).size, 360);
  for (const topic of TOPICS) assert.equal(EXERCISES.filter((item) => item.topic === topic.id).length, 30, topic.name);
  for (const task of EXERCISES) {
    assert.ok(task.core && task.meaning);
    assert.ok(task.core.split(/\s+/).length <= 10, `基础句应简短：${task.core}`);
    assert.match(task.meaning, /[\u4e00-\u9fff]/);
    assert.equal(task.steps.length, 3);
    for (const [index, step] of task.steps.entries()) {
      assert.ok(step.goal && step.hint);
      assert.equal(answerError(step.reference), null);
      const previous = index ? task.steps[index - 1].reference : task.core;
      assert.ok(step.reference.startsWith(previous.slice(0, -1)), `下一步要保留前一步：${task.id}`);
      assert.ok(step.reference.length > previous.length);
      assert.match(step.reference, /\.$/);
    }
  }
});

test("旧题草稿和历史依旧可读，并映射到新主题", () => {
  for (const [id, topic] of [["campus-discuss", "education"], ["daily-cook", "family"], ["work-meeting", "work"], ["society-app", "technology"]]) {
    const task = exerciseById(id);
    assert.equal(task.topic, topic);
    const saved = newSession(id, "basic", "legacy-session", 1000);
    assert.equal(readStore(JSON.stringify({ session: saved })).session.exerciseId, id);
  }
  const records = LEGACY.map((task) => {
    let session = newSession(task.id, "basic", `legacy-${task.id}`, 1000);
    for (let index = 0; index < 3; index += 1) session = advanceSession(session, 2000 + index);
    return session;
  });
  assert.equal(cleanStore({ records }).records.length, 20);
  for (const task of LEGACY) assert.ok(TOPICS.some((topic) => topic.id === exerciseById(task.id).topic));
});

test("默认使用官方 DeepSeek Flash，规范化完整端点和 v1 地址", () => {
  assert.deepEqual(DEFAULT_CONFIG, { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" });
  const normalized = normalizeConfig({ ...DEFAULT_CONFIG, apiKey: " sk-test-only " });
  assert.equal(normalized.apiKey, "sk-test-only");
  assert.equal(normalized.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(normalizeConfig({ ...DEFAULT_CONFIG, apiKey: "x", baseUrl: "https://example.com/v1/chat/completions/" }).endpoint,
    "https://example.com/v1/chat/completions");
  assert.equal(normalizeConfig({ ...DEFAULT_CONFIG, apiKey: "x", baseUrl: "http://localhost:1234/v1" }).endpoint,
    "http://localhost:1234/v1/chat/completions");
});

test("无效配置不能发送凭据到不安全或夹带参数的地址", () => {
  const base = { ...DEFAULT_CONFIG, apiKey: "test" };
  for (const baseUrl of ["http://remote.example", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com?key=x", "https://example.com/#x"]) {
    assert.throws(() => normalizeConfig({ ...base, baseUrl }));
  }
  assert.throws(() => normalizeConfig({ ...base, apiKey: "" }));
  assert.throws(() => normalizeConfig({ ...base, apiKey: "abc\nxyz" }));
  assert.throws(() => normalizeConfig({ ...base, model: "bad model" }));
});

test("三步承接原句，保存用户提交原稿与 AI 建议，完成后记录只生成一次", () => {
  let session = fresh();
  session.draft = "Students read science books.";
  session.feedback = feedback;
  session.reviewedAnswer = session.draft;
  session.draft = feedback.suggestion;
  session.adopted = session.usedAi = true;
  session = advanceSession(session, 2000);
  assert.equal(session.step, 1);
  assert.equal(session.draft, feedback.suggestion);
  assert.equal(session.feedback, null);
  assert.equal(session.steps[0].reviewedAnswer, "Students read science books.");
  session.draft += " after class";
  session = advanceSession(session, 3000);
  session.draft += " to learn more.";
  session = advanceSession(session, 4000);
  assert.equal(session.completed, true);
  assert.equal(session.steps.length, 3);
  assert.equal(advanceSession(session, 5000), session);
  const records = recordCompleted(recordCompleted([], session), session);
  assert.equal(records.length, 1);
  assert.equal(records[0].steps[0].adopted, true);
});

test("完成记录只留最近 RECORD_LIMIT 条 —— 本地存储不能无限涨", () => {
  // 每完成一题就多一条记录，而且每次落盘都要把全部记录重新序列化一遍，
  // 所以这个上限同时也是「打字时那一下」不随使用时间变慢的保证。
  const completed = (id) => {
    let session = newSession("campus-books", "basic", id, 1000);
    for (let index = 0; index < 3; index += 1) {
      session.draft = `Students read books, step ${index + 1}.`;
      session = advanceSession(session, 2000 + index);
    }
    return session;
  };
  let records = [];
  for (let index = 0; index < RECORD_LIMIT + 5; index += 1) {
    records = recordCompleted(records, completed(`session-${index}`));
  }
  assert.equal(records.length, RECORD_LIMIT);
  // 最新的在最前面，最老的被挤出去
  assert.equal(records[0].id, `session-${RECORD_LIMIT + 4}`);
  assert.ok(!records.some((item) => item.id === "session-0"));
  assert.equal(new Set(records.map((item) => item.id)).size, RECORD_LIMIT);
});

test("返回上一步恢复原稿，修改后截断下游旧步骤", () => {
  let session = advanceSession(fresh(), 2000);
  session.draft = "Students read books in the library.";
  session = advanceSession(session, 3000);
  session = previousStep(previousStep(session));
  assert.equal(session.step, 0);
  assert.equal(session.draft, "Students read books.");
  session.draft = "Students read history books.";
  session = advanceSession(session, 4000);
  assert.equal(session.steps.length, 1);
  assert.equal(session.draft, "Students read history books.");
});

test("草稿与历史恢复只允许练习字段，顶层和步骤内的凭据都不会落盘", () => {
  let session = fresh();
  session.apiKey = "secret-must-not-persist";
  session = advanceSession(session, 2000);
  session.steps[0].apiKey = "secret-must-not-persist";
  const cleaned = cleanStore({ session, records: [], config: { apiKey: "secret-must-not-persist" } });
  const json = JSON.stringify(cleaned);
  assert.ok(!json.includes("secret-must-not-persist"));
  assert.deepEqual(readStore(json), cleaned);
  assert.equal(cleaned.session.step, 1);
  assert.equal(readStore("broken").session, null);
  assert.equal(readStore('{"session":{"id":"x"}}').session, null);
  assert.equal(cleanStore({ session: { ...session, steps: [{}] } }).session, null);
  assert.equal(cleanStore({ session: { ...session, completed: true } }).session, null);
});

test("拒绝空答案、超长答案和不完整的 AI 反馈，不伪造合格结果", () => {
  for (const draft of ["", "   ", "只有中文", "x".repeat(1201)]) {
    assert.ok(answerError(draft));
    assert.throws(() => advanceSession({ ...fresh(), draft }, 2000));
  }
  assert.deepEqual(parseFeedback(feedback), feedback);
  for (const value of [null, {}, { ...feedback, needs_revision: "false" }, { ...feedback, suggestion: "" }, { ...feedback, corrections: [12] }]) {
    assert.throws(() => parseFeedback(value));
  }
  assert.equal(exerciseById("unknown"), null);
});
