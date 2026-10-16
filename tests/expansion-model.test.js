import test from "node:test";
import assert from "node:assert/strict";
import { EXERCISES, TOPICS, exerciseById } from "../src/expansion/exercises.js";
import { ARGUMENT_METHODS, METHOD_IDS } from "../src/expansion/methods.js";
import { DEFAULT_CONFIG, STORE_VERSION, MAX_ARGUMENTS, newSession, addArgument, removeArgument,
  setClaimText, setArgumentText, setClaimOptimized, setArgumentOptimized,
  toggleClaimCheck, toggleArgumentCheck, fusionStatus, fusionPayload, fuseSession,
  normalizeConfig, readStore, cleanStore, cleanSession, answerError, parseOptimized, parseParagraph,
  recordCompleted, RECORD_LIMIT } from "../src/expansion/expansion-model.js";

const fresh = () => newSession("campus-books", "session-1", 1000);

test("12 个主题各有 30 道基础论点，题干简短、id 与释义唯一", () => {
  assert.equal(TOPICS.length, 12);
  assert.equal(EXERCISES.length, 360);
  assert.equal(new Set(EXERCISES.map((item) => item.id)).size, 360);
  assert.equal(new Set(EXERCISES.map((item) => item.claim.toLowerCase())).size, 360);
  for (const topic of TOPICS) assert.equal(EXERCISES.filter((item) => item.topic === topic.id).length, 30, topic.name);
  for (const task of EXERCISES) {
    assert.ok(task.claim && task.meaning);
    assert.ok(task.claim.split(/\s+/).length <= 16, `基础论点应简短：${task.claim}`);
    assert.match(task.claim, /\.$/, `基础论点应是一句：${task.claim}`);
    assert.match(task.meaning, /[一-鿿]/);
    assert.equal(answerError(task.claim), null);
  }
  assert.equal(exerciseById("campus-books").topic, "education");
  assert.equal(exerciseById("unknown"), null);
  // 旧题号只属于已经删掉的三步流程，不再能被查到。
  assert.equal(exerciseById("campus-discuss"), null);
});

test("七种论证方法各有中文说明与常用衔接，id 唯一", () => {
  assert.equal(ARGUMENT_METHODS.length, 7);
  assert.equal(METHOD_IDS.size, 7);
  for (const method of ARGUMENT_METHODS) {
    assert.ok(method.id && method.name && method.en && method.note);
    assert.ok(method.connectives.length >= 3, method.id);
    assert.ok(method.connectives.every((item) => item && typeof item === "string"));
  }
});

test("新建 session 只有论点改写与空论证区，不含旧的三步字段", () => {
  const session = fresh();
  assert.equal(session.claimEdit.text, "");
  assert.equal(session.claimEdit.optimized, "");
  assert.equal(session.claimEdit.checkedText, false);
  assert.deepEqual(session.arguments, []);
  assert.equal(session.fusion, "");
  assert.equal(session.completed, false);
  for (const gone of ["steps", "step", "level", "draft", "feedback", "hint", "adopted", "reviewedAnswer"]) {
    assert.ok(!(gone in session), `不该再有旧字段：${gone}`);
  }
  assert.throws(() => newSession("unknown", "session-1", 1000));
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

test("添加与删除论证块保持添加顺序与 id 唯一", () => {
  let session = fresh();
  session = addArgument(session, "cause", "a1", 2000);
  session = addArgument(session, "example", "a2", 3000);
  session = addArgument(session, "cause", "a3", 4000);   // 同一种方法可以再加一块
  assert.deepEqual(session.arguments.map((item) => item.id), ["a1", "a2", "a3"]);
  assert.deepEqual(session.arguments.map((item) => item.method), ["cause", "example", "cause"]);
  assert.throws(() => addArgument(session, "unknown-method", "a4", 5000));
  assert.throws(() => addArgument(session, "cause", "a1", 5000));
  session = removeArgument(session, "a2", 6000);
  assert.deepEqual(session.arguments.map((item) => item.id), ["a1", "a3"]);
  assert.equal(removeArgument(session, "never-added", 7000), session);
  let full = fresh();
  for (let index = 0; index < MAX_ARGUMENTS; index += 1) full = addArgument(full, "cause", `b${index}`, 1000);
  assert.equal(full.arguments.length, MAX_ARGUMENTS);
  assert.throws(() => addArgument(full, "cause", "one-more", 1000));
});

test("清空输入框会取消该块的原句勾选，优化版的勾不受影响", () => {
  let session = setClaimText(fresh(), "Schools should teach more practical skills.", 2000);
  session = setClaimOptimized(session, "Schools ought to deliver more practical instruction.", 2100);
  session = toggleClaimCheck(session, "text", 2200);
  session = toggleClaimCheck(session, "optimized", 2300);
  assert.equal(session.claimEdit.checkedText, true);
  assert.equal(session.claimEdit.checkedOptimized, true);
  session = setClaimText(session, "", 2400);
  assert.equal(session.claimEdit.checkedText, false);
  assert.equal(session.claimEdit.checkedOptimized, true);
});

test("重新优化覆盖旧结果并保留优化版勾选", () => {
  let session = setClaimText(fresh(), "Schools should teach practical skills.", 2000);
  session = setClaimOptimized(session, "Schools ought to deliver practical instruction.", 2100);
  session = toggleClaimCheck(session, "optimized", 2200);
  session = setClaimOptimized(session, "Schools should prioritise the delivery of practical instruction.", 2300);
  assert.equal(session.claimEdit.optimized, "Schools should prioritise the delivery of practical instruction.");
  assert.equal(session.claimEdit.checkedOptimized, true);
  assert.equal(session.claimEdit.usedAi, true);
});

test("空的写作块不可勾选，也不计入所需的论证数", () => {
  let session = addArgument(fresh(), "cause", "a1", 2000);
  session = toggleClaimCheck(session, "text", 2100);
  // 目标槽是空的，勾不动 —— 返回原样的 session，不是抛错
  assert.equal(toggleArgumentCheck(session, "a1", "text", 2100), session);
  assert.equal(toggleArgumentCheck(session, "a1", "optimized", 2100), session);
  assert.equal(toggleClaimCheck(session, "text", 2100), session);
  assert.equal(toggleArgumentCheck(session, "never-added", "text", 2100), session);
  // 论点也没写，所以连论点这一条都不满足
  assert.equal(fusionStatus(session).count, 0);
});

test("融合可用规则：需一版论点 + 两块不同论证（同块两版只算一块）", () => {
  let session = setClaimText(fresh(), "Schools should teach practical skills.", 2000);
  assert.equal(fusionStatus(session).ok, false);
  assert.match(fusionStatus(session).reason, /论点/);

  session = addArgument(session, "cause", "a1", 2100);
  session = setArgumentText(session, "a1", "This is because employers need ready skills.", 2200);
  session = toggleClaimCheck(session, "text", 2300);
  session = toggleArgumentCheck(session, "a1", "text", 2300);
  assert.equal(fusionStatus(session).ok, false);
  assert.equal(fusionStatus(session).count, 1);
  assert.match(fusionStatus(session).reason, /1 个/);

  // 同一块再勾上优化版，仍然只是一块 —— 这是这个练习要求学生换方法的地方
  session = setArgumentOptimized(session, "a1", "This is because employers require job-ready skills.", 2400);
  session = toggleArgumentCheck(session, "a1", "optimized", 2500);
  assert.equal(fusionStatus(session).count, 1);
  assert.equal(fusionStatus(session).ok, false);

  session = addArgument(session, "example", "a2", 2600);
  session = setArgumentText(session, "a2", "For instance, vocational schools place graduates quickly.", 2700);
  session = toggleArgumentCheck(session, "a2", "text", 2800);
  const status = fusionStatus(session);
  assert.equal(status.ok, true);
  assert.equal(status.count, 2);
  assert.equal(status.reason, "");
});

test("融合送模型的顺序：先论点，再按添加顺序", () => {
  let session = setClaimText(fresh(), "Schools should teach practical skills.", 2000);
  session = toggleClaimCheck(session, "text", 2100);
  session = addArgument(session, "cause", "a1", 2200);
  session = addArgument(session, "example", "a2", 2300);
  session = setArgumentText(session, "a1", "This is because employers need ready skills.", 2400);
  session = setArgumentText(session, "a2", "For instance, vocational schools place graduates quickly.", 2500);
  session = setArgumentOptimized(session, "a1", "This is because employers require job-ready skills.", 2600);
  session = toggleArgumentCheck(session, "a1", "optimized", 2700);
  session = toggleArgumentCheck(session, "a2", "text", 2700);
  assert.deepEqual(fusionPayload(session).map((part) => `${part.role}:${part.source}`),
    ["claim:text", "argument:optimized", "argument:text"]);
  assert.deepEqual(fusionPayload(session).map((part) => part.text), [
    "Schools should teach practical skills.",
    "This is because employers require job-ready skills.",
    "For instance, vocational schools place graduates quickly."]);
  assert.equal(fusionPayload(session)[1].method, "cause");

  // 论点两版都勾时，原句在前、优化版在后
  session = setClaimOptimized(session, "Schools should prioritise practical instruction.", 3000);
  session = toggleClaimCheck(session, "optimized", 3100);
  assert.deepEqual(fusionPayload(session).map((part) => `${part.role}:${part.source}`),
    ["claim:text", "claim:optimized", "argument:optimized", "argument:text"]);

  // 没勾的一律不送
  session = setArgumentText(session, "a2", "", 3200);
  assert.ok(!fusionPayload(session).some((part) => part.text.includes("vocational")));
});

test("融合后完成并生成记录；空段落被拒绝", () => {
  let session = setClaimText(fresh(), "Schools should teach practical skills.", 2000);
  session = addArgument(session, "cause", "a1", 2100);
  session = setArgumentText(session, "a1", "This is because employers need ready skills.", 2200);
  session = setArgumentOptimized(session, "a1", "This is because employers require job-ready skills.", 2300);
  session = addArgument(session, "example", "a2", 2400);
  session = setArgumentText(session, "a2", "For instance, vocational schools place graduates quickly.", 2500);
  session = fuseSession(session, "  Schools should teach practical skills.  ", 3000);
  assert.equal(session.fusion, "Schools should teach practical skills.");
  assert.equal(session.completed, true);
  for (const bad of ["", "   ", null, 42, undefined]) assert.throws(() => fuseSession(fresh(), bad, 3000));

  const records = recordCompleted(recordCompleted([], session), session);
  assert.equal(records.length, 1);
  const record = records[0];
  // 记录留着完整过程：论点两版、每条论证的两版与所用方法、最后的段落
  assert.equal(record.fusion, session.fusion);
  assert.equal(record.claimEdit.text, "Schools should teach practical skills.");
  assert.equal(record.arguments.length, 2);
  assert.deepEqual(record.arguments.map((item) => item.method), ["cause", "example"]);
  assert.equal(record.arguments[0].optimized, "This is because employers require job-ready skills.");
  assert.equal(record.arguments[1].text, "For instance, vocational schools place graduates quickly.");
  // 没写段落的不算完成，也就进不了记录
  assert.deepEqual(recordCompleted([], setClaimText(fresh(), "Schools should teach practical skills.", 2000)), []);
});

test("完成记录只留最近 RECORD_LIMIT 条 —— 本地存储不能无限涨", () => {
  // 每完成一题就多一条记录，而且每次落盘都要把全部记录重新序列化一遍，
  // 所以这个上限同时也是「打字时那一下」不随使用时间变慢的保证。
  const completed = (id) => fuseSession(
    setClaimText(newSession("campus-books", id, 1000), "Schools should teach practical skills.", 2000),
    "Schools should teach practical skills.", 3000);
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

test("草稿与历史恢复只允许练习字段，顶层和块内的凭据都不会落盘", () => {
  let session = setClaimText(fresh(), "Schools should teach practical skills.", 2000);
  session.apiKey = "secret-must-not-persist";
  session.claimEdit.apiKey = "secret-must-not-persist";
  session = addArgument(session, "cause", "a1", 2100);
  session.arguments[0].apiKey = "secret-must-not-persist";
  const cleaned = cleanStore({ version: STORE_VERSION, session, records: [], config: { apiKey: "secret-must-not-persist" } });
  const json = JSON.stringify(cleaned);
  assert.ok(!json.includes("secret-must-not-persist"));
  assert.deepEqual(readStore(json), cleaned);
  assert.equal(cleaned.session.claimEdit.text, "Schools should teach practical skills.");
  assert.equal(readStore("broken").session, null);
  assert.equal(readStore('{"session":{"id":"x"}}').session, null);
  assert.equal(cleanStore(null).session, null);
  assert.equal(cleanStore({ version: STORE_VERSION, session: { ...session, claimEdit: null } }).session, null);
});

test("存储升到 v2：旧的三步草稿与旧记录整体清空", () => {
  const legacy = { version: 1,
    session: { id: "old-draft", exerciseId: "campus-books", level: "basic", step: 2,
      draft: "Students read books about science.", steps: [], completed: false },
    records: [{ id: "old-record", exerciseId: "campus-books", level: "basic", step: 2, steps: [], completed: true }] };
  assert.deepEqual(cleanStore(legacy), { version: STORE_VERSION, session: null, records: [] });
  assert.equal(readStore(JSON.stringify(legacy)).session, null);
  // 就算绕过 version 闸门，老结构没有 claimEdit 也过不了净化
  assert.equal(cleanSession(legacy.session), null);
  // 版本正确的新存档照常读回
  const kept = fuseSession(setClaimText(fresh(), "Schools should teach practical skills.", 2000), "One paragraph.", 3000);
  const store = cleanStore({ version: STORE_VERSION, session: kept, records: [kept] });
  assert.equal(store.session.id, kept.id);
  assert.equal(store.records.length, 1);
});

test("净化丢弃单个坏块但保住整份草稿；超量按规则处理", () => {
  let session = setClaimText(fresh(), "Schools should teach practical skills.", 2000);
  session = addArgument(session, "cause", "a1", 2100);
  session = setArgumentText(session, "a1", "This is because employers need ready skills.", 2200);
  session = addArgument(session, "example", "a2", 2300);
  session = setArgumentText(session, "a2", "For instance, vocational schools place graduates quickly.", 2400);
  const damaged = cleanSession({ ...session, arguments: [session.arguments[0], null,
    { id: "a1", method: "cause", text: "same id again" },
    { id: "bad", method: "not-a-method", text: "unknown method" },
    session.arguments[1]] });
  // 坏块被丢掉，好的两块还在，顺序不变
  assert.deepEqual(damaged.arguments.map((item) => item.id), ["a1", "a2"]);

  // 块数超上限 = 存档被改坏了，整份作废
  const tooMany = { ...session, arguments: Array.from({ length: MAX_ARGUMENTS + 1 },
    (_, index) => ({ id: `x${index}`, method: "cause", text: "some text here" })) };
  assert.equal(cleanSession(tooMany), null);

  // 勾了但文本是空的，净化后勾必须消失
  const stale = cleanSession({ ...session, claimEdit: { text: "", optimized: "", checkedText: true, checkedOptimized: true } });
  assert.equal(stale.claimEdit.checkedText, false);
  assert.equal(stale.claimEdit.checkedOptimized, false);
});

test("拒绝空答案、超长答案和不完整的 AI 返回值，不伪造合格结果", () => {
  for (const draft of ["", "   ", "只有中文", "x".repeat(1201)]) assert.ok(answerError(draft));
  assert.equal(answerError("Schools should teach practical skills."), null);

  assert.equal(parseOptimized({ optimized: "  Schools ought to do so.  " }), "Schools ought to do so.");
  assert.equal(parseParagraph({ paragraph: "  One connected paragraph.  " }), "One connected paragraph.");
  for (const value of [null, {}, [], { optimized: 4 }, { optimized: "" }, { optimized: "只有中文" },
    { optimized: "x".repeat(1201) }]) {
    assert.throws(() => parseOptimized(value));
  }
  for (const value of [null, {}, [], { paragraph: "" }, { paragraph: "只有中文" },
    { paragraph: "x".repeat(6001) }]) {
    assert.throws(() => parseParagraph(value));
  }
  // 段落比单句长得多，所以用的是更宽的上限
  assert.equal(parseParagraph({ paragraph: "x".repeat(1201) }).length, 1201);
  assert.throws(() => parseOptimized({ optimized: "x".repeat(1201) }));
});
