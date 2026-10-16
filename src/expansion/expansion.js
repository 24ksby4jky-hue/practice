import * as View from "../view.js";
import { EXERCISES, TOPICS, LEVELS, exerciseById } from "./exercises.js";
import { STORAGE_KEY, MAX_ANSWER, DEFAULT_CONFIG, newSession, answerError, normalizeConfig,
  advanceSession, previousStep, cleanStore, readStore, recordCompleted } from "./expansion-model.js";
import { testConnection, requestCoach } from "./ai-client.js";

const host = document.getElementById("expansion-view");
let store;
try { store = readStore(localStorage.getItem(STORAGE_KEY)); }
catch { store = readStore(null); }
// 凭据始终只存在模块内存，不进入 localStorage、sessionStorage、URL 或练习记录。
let config = { ...DEFAULT_CONFIG, apiKey: "" };
let settingsDraft = { ...config };
let connected = false;
let offline = false;
let settingsOpen = true;
let screen = "practice";
let picking = !store.session;
let topic = exerciseById(store.session?.exerciseId)?.topic || TOPICS[0].id;
let level = store.session?.level || "basic";
let error = "";
let notice = "";
let busy = null;
let controller = null;
let requestSerial = 0;
let storageFailed = false;

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
function button(id, text, action, primary = false) {
  const element = node("button", primary ? "primary" : "", text);
  element.type = "button";
  if (id) element.id = id;
  element.addEventListener("click", action);
  return element;
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanStore(store)));
    storageFailed = false;
  } catch { storageFailed = true; }
  const warning = document.getElementById("exp-storage-warning");
  if (warning) warning.textContent = storageFailed ? "本地保存失败，当前内容仍在页面中，请复制备份后再离开。" : "";
}
function cancelRequest(message = "") {
  requestSerial += 1;
  controller?.abort();
  controller = null;
  busy = null;
  notice = message;
}
function change(action) {
  cancelRequest();
  error = "";
  action();
  render();
}
function focusEditor() { document.getElementById("exp-answer")?.focus(); }

function render() {
  host.replaceChildren();
  const head = node("div", "page-head expansion-head");
  const title = node("div");
  title.append(node("h2", "", "句子扩写练习"), node("p", "hint", "IELTS Writing Task 2 · 从基础观点句开始，逐步展开论述。"));
  const tools = node("div", "exp-actions");
  tools.append(node("span", "hint exp-connection", connected ? `已连接 · ${config.model}` : "AI 未连接"),
    button("exp-settings-toggle", settingsOpen ? "收起 AI 设置" : "AI 设置", () => change(() => { settingsOpen = !settingsOpen; })));
  head.append(title, tools);
  const nav = node("div", "exp-tabs");
  for (const [id, label] of [["practice", "练习"], ["records", `我的句子 · ${store.records.length}`]]) {
    const tab = button(`exp-tab-${id}`, label, () => change(() => { screen = id; }));
    tab.classList.toggle("active", screen === id);
    tab.setAttribute("aria-pressed", String(screen === id));
    nav.append(tab);
  }
  host.append(head, nav);
  const messages = node("div", "exp-messages");
  if (error) {
    const alert = node("p", "exp-error", error);
    alert.setAttribute("role", "alert");
    messages.append(alert);
  }
  if (notice) {
    const status = node("p", "hint", notice);
    status.setAttribute("role", "status");
    messages.append(status);
  }
  const warning = node("p", "exp-error", storageFailed ? "本地保存失败，请复制当前句子备份。" : "");
  warning.id = "exp-storage-warning";
  warning.setAttribute("role", "status");
  messages.append(warning);
  host.append(messages);
  if (settingsOpen) host.append(renderSettings());
  if (screen === "records") renderRecords();
  else if (!connected && !offline) {
    host.append(node("p", "exp-welcome", "先填写 API Key 并测试连接，即可使用 AI 提示和优化。也可以先独立练习，稍后再连接。"));
  } else if (picking || !store.session) renderPicker();
  else if (store.session.completed) renderSummary(store.session);
  else renderExercise();
}

function renderSettings() {
  const box = node("section", "exp-settings");
  box.append(node("h3", "", "连接你的 AI"), node("p", "hint", "默认 DeepSeek Flash。Key 仅在当前页面内存中保留，刷新后需重新填写，不随练习记录保存。"));
  const form = node("form", "exp-config-form");
  form.autocomplete = "off";
  // 高级设置收起时也能在页面上显示校验错误，不让浏览器聚焦隐藏输入框。
  form.noValidate = true;
  const keyLabel = node("label", "exp-field", "API Key");
  const key = node("input");
  key.id = "exp-api-key";
  key.type = "password";
  key.autocomplete = "off";
  key.spellcheck = false;
  key.required = true;
  key.placeholder = "填写你的 DeepSeek API Key";
  key.value = settingsDraft.apiKey;
  key.disabled = Boolean(busy);
  key.addEventListener("input", () => { settingsDraft.apiKey = key.value; });
  keyLabel.append(key);
  const advanced = node("details", "exp-advanced");
  advanced.append(node("summary", "", "高级设置 · 接口地址与模型"));
  for (const [field, label] of [["baseUrl", "API 地址"], ["model", "模型名称"]]) {
    const wrap = node("label", "exp-field", label);
    const input = node("input");
    input.id = field === "baseUrl" ? "exp-base-url" : "exp-model";
    input.type = field === "baseUrl" ? "url" : "text";
    input.required = true;
    input.spellcheck = false;
    input.value = settingsDraft[field];
    input.disabled = Boolean(busy);
    input.addEventListener("input", () => { settingsDraft[field] = input.value; updateDestination(); });
    wrap.append(input);
    advanced.append(wrap);
  }
  const destination = node("p", "hint exp-destination");
  function updateDestination() {
    let origin;
    try { origin = new URL(settingsDraft.baseUrl).origin; } catch { origin = "你填写的接口地址"; }
    destination.textContent = `Key 将直接发送至 ${origin}。AI 提示和检查会发送本题、当前句子及本题前几步的内容，并使用你的 API 额度。`;
  }
  updateDestination();
  const actions = node("div", "exp-actions");
  const connect = node("button", "primary", busy === "connection" ? "正在测试连接…" : "测试连接并使用");
  connect.type = "submit";
  connect.id = "exp-connect";
  connect.disabled = Boolean(busy);
  actions.append(connect);
  if (busy === "connection") actions.append(button("exp-cancel-connect", "取消请求", () => { cancelRequest("已取消连接测试。"); render(); }));
  const clear = button("exp-clear-key", "清除 Key", () => change(() => {
    config = { ...DEFAULT_CONFIG, apiKey: "" };
    settingsDraft = { ...config };
    connected = false;
    offline = true;
    notice = "Key 已从本页清除，可以继续独立练习。";
  }));
  clear.disabled = Boolean(busy);
  const skip = button("exp-offline", "先独立练习", () => change(() => { offline = true; settingsOpen = false; }));
  skip.disabled = Boolean(busy);
  actions.append(skip, clear);
  form.append(keyLabel, advanced, destination, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    let candidate;
    try { candidate = normalizeConfig(settingsDraft); }
    catch (failure) { error = failure.message; render(); return; }
    const token = ++requestSerial;
    controller = new AbortController();
    busy = "connection";
    connected = false;
    if (store.session) offline = true;
    error = notice = "";
    render();
    try {
      await testConnection(candidate, { signal: controller.signal });
      if (token !== requestSerial) return;
      config = candidate;
      connected = true;
      offline = false;
      settingsOpen = false;
      notice = "连接成功。选择一道题开始扩写。";
    } catch (failure) {
      if (token !== requestSerial) return;
      if (failure.name !== "AbortError") error = failure.message;
    } finally {
      if (token === requestSerial) { busy = null; controller = null; render(); }
    }
  });
  box.append(form);
  return box;
}

function renderPicker() {
  const box = node("section", "exp-picker");
  const bar = node("div", "exp-filter-bar");
  for (const [items, label, value, onChange, id] of [
    [TOPICS, "主题", topic, (value) => { topic = value; }, "exp-topic"],
    [LEVELS, "难度", level, (value) => { level = value; }, "exp-level"]
  ]) {
    const wrap = node("label", "exp-inline-label", label);
    const select = node("select");
    select.id = id;
    for (const item of items) select.add(new Option(item.name, item.id));
    select.value = value;
    select.addEventListener("change", () => { onChange(select.value); render(); });
    wrap.append(select);
    bar.append(wrap);
  }
  const topicTasks = EXERCISES.filter((item) => item.topic === topic);
  bar.append(node("span", "hint", `本主题 ${topicTasks.length} 句 · 共 ${TOPICS.length} 个主题 / ${EXERCISES.length} 句 · ${LEVELS.find((item) => item.id === level).note}`));
  box.append(bar);
  box.append(node("p", "hint", "按常见雅思大作文题材编排的原创基础句，供练习论述表达，并非官方真题。"));
  const hasDraft = store.session && !store.session.completed;
  if (hasDraft) {
    const resume = node("div", "exp-resume");
    resume.append(node("p", "hint", "当前草稿已自动保存。开始另一道题会替换当前草稿，已完成的记录不受影响。"),
      button("exp-resume", "继续当前草稿", () => change(() => { picking = false; })));
    box.append(resume);
  }
  const list = node("div", "exp-exercise-list");
  for (const [index, task] of topicTasks.entries()) {
    const row = node("div", "exp-exercise-row");
    const content = node("div");
    const sentence = node("p", "exp-english", task.core);
    sentence.prepend(node("span", "exp-question-number", `${String(index + 1).padStart(2, "0")} / ${topicTasks.length}`));
    content.append(sentence, node("p", "hint", task.meaning));
    row.append(content, button(`exp-start-${task.id}`, hasDraft ? "替换草稿并开始" : "开始扩写", () => startExercise(task.id)));
    list.append(row);
  }
  box.append(list);
  host.append(box);
}

function startExercise(id, selectedLevel = level) {
  change(() => {
    store.session = newSession(id, selectedLevel, crypto.randomUUID(), Date.now());
    topic = exerciseById(id).topic;
    level = selectedLevel;
    picking = false;
    screen = "practice";
    save();
  });
  focusEditor();
}

function renderExercise() {
  const session = store.session;
  const task = exerciseById(session.exerciseId);
  const box = node("section", "exp-practice");
  const meta = node("div", "exp-filter-bar");
  meta.append(node("p", "hint", `${TOPICS.find((item) => item.id === task.topic).name} · ${LEVELS.find((item) => item.id === session.level).name}`),
    button("exp-change-exercise", "选择其他题目", () => change(() => { picking = true; })));
  const core = node("div", "exp-core");
  core.append(node("p", "exp-eyebrow", "核心句 · 保留原意"), node("p", "exp-core-sentence", task.core), node("p", "hint", task.meaning));
  const steps = node("ol", "exp-steps");
  for (let index = 0; index < 3; index += 1) {
    const item = node("li", index === session.step ? "current" : index < session.step ? "done" : "", `0${index + 1} ${["补充细节", "丰富情境", "连接逻辑"][index]}`);
    if (index === session.step) item.setAttribute("aria-current", "step");
    steps.append(item);
  }
  const goal = node("h3", "exp-goal", `第 ${session.step + 1} 步：${task.steps[session.step].goal}`);
  goal.id = "exp-goal";
  const label = node("label", "exp-field", "你的句子");
  const editor = node("textarea", "exp-answer");
  editor.id = "exp-answer";
  editor.rows = 4;
  editor.maxLength = MAX_ANSWER;
  editor.lang = "en";
  editor.spellcheck = true;
  editor.value = session.draft;
  editor.readOnly = Boolean(busy);
  editor.setAttribute("aria-describedby", "exp-goal exp-word-count");
  const count = node("p", "hint exp-word-count", `${session.draft.length} / ${MAX_ANSWER} 字符 · 草稿自动保存在本机`);
  count.id = "exp-word-count";
  editor.addEventListener("input", () => {
    session.draft = editor.value;
    session.updatedAt = Date.now();
    count.textContent = `${session.draft.length} / ${MAX_ANSWER} 字符 · 草稿自动保存在本机`;
    const stale = document.getElementById("exp-feedback-stale");
    if (stale) stale.textContent = session.draft !== session.reviewedAnswer ? "你已修改句子，可再次检查当前版本。" : "";
    save();
  });
  label.append(editor);
  const actions = node("div", "exp-actions");
  for (const [mode, text] of [["hint", "AI 给我提示"], ["feedback", "AI 检查与优化"]]) {
    const action = button(`exp-ai-${mode}`, busy === mode ? "正在等待 AI…" : text, () => askAI(mode), mode === "feedback");
    action.disabled = Boolean(busy);
    actions.append(action);
  }
  if (busy) actions.append(button("exp-cancel-ai", "取消请求", () => { cancelRequest("请求已取消，原稿已保留。"); render(); }));
  const local = node("details", "exp-reference");
  local.append(node("summary", "", "本地提示与参考表达"), node("p", "", task.steps[session.step].hint));
  const reference = node("details");
  reference.append(node("summary", "", "展开参考句"), node("p", "exp-english", task.steps[session.step].reference),
    node("p", "hint", "这是一种写法，你可以表达不同的信息。"));
  local.append(reference);
  box.append(meta, core, steps, goal, label, count, actions);
  if (session.hint) {
    const hint = node("section", "exp-feedback");
    hint.append(node("h3", "", "AI 提示"), node("p", "", session.hint));
    box.append(hint);
  }
  if (session.feedback) box.append(feedbackBlock(session, true));
  box.append(local, node("p", "hint", "AI 反馈供参考；如有疑问，可以保留自己的表达。只在点击 AI 按钮时发起请求。"));
  const navigation = node("div", "exp-step-actions");
  if (session.step > 0) {
    const previous = button("exp-previous-step", "返回上一步", () => change(() => { store.session = previousStep(session); save(); }));
    previous.disabled = Boolean(busy);
    navigation.append(previous);
  }
  const next = button("exp-next-step", session.step === 2 ? "完成并保存句子" : "保留这句，进入下一步", () => {
    const invalid = answerError(session.draft);
    if (invalid) { error = invalid; render(); focusEditor(); return; }
    change(() => {
      store.session = advanceSession(session, Date.now());
      if (store.session.completed) store.records = recordCompleted(store.records, store.session);
      save();
    });
    focusEditor();
  }, true);
  next.disabled = Boolean(busy);
  navigation.append(next);
  box.append(navigation);
  host.append(box);
}

function feedbackBlock(attempt, canAdopt) {
  const feedback = attempt.feedback;
  const block = node("section", "exp-feedback");
  block.append(node("h3", "", "AI 检查与优化"), node("p", "hint", `检查时的句子：${attempt.reviewedAnswer || attempt.answer || ""}`),
    node("p", "", feedback.status));
  if (feedback.corrections.length) {
    const list = node("ul");
    for (const correction of feedback.corrections) list.append(node("li", "", correction));
    block.append(list);
  }
  block.append(node("p", "exp-eyebrow", "建议版本"), node("p", "exp-english", feedback.suggestion), node("p", "", feedback.explanation));
  if (canAdopt) {
    const stale = node("p", "hint", attempt.draft !== attempt.reviewedAnswer ? "你已修改句子，可再次检查当前版本。" : "");
    stale.id = "exp-feedback-stale";
    const adopt = button("exp-adopt", "采用这个版本", () => change(() => {
      attempt.draft = feedback.suggestion;
      attempt.adopted = true;
      attempt.updatedAt = Date.now();
      save();
    }));
    adopt.disabled = Boolean(busy);
    block.append(stale, adopt);
  }
  return block;
}

async function askAI(mode) {
  if (busy) return;
  if (!connected) {
    settingsOpen = true;
    notice = "先测试连接，再使用 AI。当前草稿已经保留。";
    render();
    document.getElementById("exp-api-key")?.focus();
    return;
  }
  const invalid = answerError(store.session.draft);
  if (invalid) { error = invalid; render(); focusEditor(); return; }
  const session = store.session;
  const snapshot = structuredClone(session);
  const token = ++requestSerial;
  controller = new AbortController();
  busy = mode;
  error = notice = "";
  render();
  try {
    const result = await requestCoach(config, mode, exerciseById(session.exerciseId), snapshot, { signal: controller.signal });
    if (token !== requestSerial || session !== store.session) return;
    session.usedAi = true;
    if (mode === "hint") session.hint = result;
    else { session.feedback = result; session.reviewedAnswer = snapshot.draft; }
    session.updatedAt = Date.now();
    save();
  } catch (failure) {
    if (token !== requestSerial) return;
    if (failure.name !== "AbortError") error = failure.message;
  } finally {
    if (token === requestSerial) { busy = null; controller = null; render(); }
  }
}

function renderSummary(session, container = host) {
  const task = exerciseById(session.exerciseId);
  const box = node("section", "exp-summary");
  box.append(node("h3", "", "从一句话，到一个完整表达"), node("p", "exp-eyebrow", "核心句"),
    node("p", "exp-english", task.core), node("p", "exp-eyebrow", "你的最终句子"),
    node("p", "exp-final-sentence", session.steps[2].answer),
    node("p", "hint", `${session.steps.some((item) => item.usedAi) ? "本题使用过 AI 帮助" : "本题未使用 AI"} · ${new Date(session.updatedAt).toLocaleString("zh-CN")}`));
  const review = node("details", "exp-review");
  review.append(node("summary", "", "回顾三步修改与反馈"));
  session.steps.forEach((attempt, index) => {
    const step = node("section", "exp-review-step");
    step.append(node("h4", "", `第 ${index + 1} 步 · ${task.steps[index].goal}`), node("p", "exp-english", attempt.answer));
    if (attempt.hint) step.append(node("p", "hint", `AI 提示：${attempt.hint}`));
    if (attempt.feedback) step.append(feedbackBlock(attempt, false));
    if (attempt.adopted) step.append(node("p", "hint", "这一步采用过 AI 建议版本。"));
    review.append(step);
  });
  box.append(review);
  const actions = node("div", "exp-actions");
  actions.append(button("", "重练这一题", () => startExercise(task.id, session.level)),
    button("", "选择下一题", () => change(() => { screen = "practice"; picking = true; })));
  box.append(actions);
  container.append(box);
}

function renderRecords() {
  const box = node("section", "exp-records");
  box.append(node("p", "hint", "只保存在当前浏览器。这里保留完成的句子、三步修改和 AI 反馈，不保存 API Key。"));
  if (!store.records.length) box.append(node("p", "exp-welcome", "还没有完成的句子。写完三步后，会自动保存在这里。"));
  for (const record of store.records) {
    const task = exerciseById(record.exerciseId);
    const details = node("details", "exp-record");
    details.append(node("summary", "", `${task.core} · ${new Date(record.updatedAt).toLocaleDateString("zh-CN")}`));
    renderSummary(record, details);
    box.append(details);
  }
  host.append(box);
}

function enter() {
  View.setHeading("句子扩写练习", "保留核心意思，逐步补充细节、情境和逻辑。");
  View.show("expansion");
  render();
}

View.register("expansion", enter, () => { cancelRequest(); save(); render(); });
