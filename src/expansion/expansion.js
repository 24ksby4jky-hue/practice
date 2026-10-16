import * as View from "../view.js";
import { EXERCISES, TOPICS, exerciseById } from "./exercises.js";
import { ARGUMENT_METHODS, methodById } from "./methods.js";
import { STORAGE_KEY, MAX_ANSWER, DEFAULT_CONFIG, newSession, answerError, normalizeConfig,
  addArgument, removeArgument, setClaimText, setArgumentText, setClaimOptimized, setArgumentOptimized,
  toggleClaimCheck, toggleArgumentCheck, fusionStatus, fusionPayload, fuseSession,
  cleanStore, readStore, recordCompleted } from "./expansion-model.js";
import { testConnection, requestClaimOptimization, requestArgumentOptimization, requestFusion } from "./ai-client.js";

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
let error = "";
let notice = "";
// 哪一块出错了 —— 优化失败要显示在它自己那一块里，而不是只丢到页面顶部。
let errorBlock = "";
let busy = null;
let controller = null;
let requestSerial = 0;
let storageFailed = false;
let saveTimer = 0;

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
// render() 是整块重画的，所以 <details> 的展开状态得自己记着 —— 否则点任何
// 一下（点 AI、换个 tab）都会把「高级设置」又合上。
// 每个可折叠块给一个稳定的 key，重画前后按 key 把展开状态搬过去。
const openPanels = new Set();
function panel(className, key) {
  const item = node("details", className);
  item.dataset.panel = key;
  return item;
}
function rememberPanels() {
  // 不清空整个表：换到「我的句子」再换回来时，那个块这一轮根本没被渲染，
  // 清空就等于把它的展开状态丢了。所以只按眼前这几个块更新 ——
  // 开着的记进来，用户主动合上的就删掉。
  for (const item of host.querySelectorAll("details[data-panel]")) {
    if (item.open) openPanels.add(item.dataset.panel);
    else openPanels.delete(item.dataset.panel);
  }
}
function restorePanels() {
  for (const item of host.querySelectorAll("details[data-panel]")) {
    if (openPanels.has(item.dataset.panel)) item.open = true;
  }
}

function save() {
  // 立刻落盘就把还没到点的那次定时写取消掉，别让它稍后再覆盖一次
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanStore(store)));
    storageFailed = false;
  } catch { storageFailed = true; }
  const warning = document.getElementById("exp-storage-warning");
  if (warning) warning.textContent = storageFailed ? "本地保存失败，当前内容仍在页面中，请复制备份后再离开。" : "";
}
// 打字时不要每敲一个键就把整份存储重写一遍 —— 里面还装着全部完成记录。
// 离散动作（AI 回来、加删论证块、离开页面）仍然立刻落盘。
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
// 延迟落盘留下的那个小窗口：正好在这 400ms 里关标签页，最后敲的那下就没了。
// pagehide 在关页面和换页时都会发，比 beforeunload 可靠。
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { if (saveTimer) save(); });
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
  errorBlock = "";
  action();
  render();
}
// randomUUID 只在 HTTPS 和 localhost 上存在。用 http://IP 打开时退回本地会话号，避免点「开始」直接抛错。
function sessionId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const blockId = sessionId;

// 论点块和论证块用同一个键空间：论点是固定的 "claim"，每个论证块是 "argument:<id>"。
// 带前缀是为了让论证块的 id 将来怎么变都不会撞上论点那一个。
const CLAIM_KEY = "claim";
const argKey = (id) => `argument:${id}`;
const argIdOf = (key) => (key === CLAIM_KEY ? null : key.slice("argument:".length));
function readBlock(session, key) {
  if (key === CLAIM_KEY) return session.claimEdit;
  return session.arguments.find((item) => item.id === argIdOf(key)) || null;
}
function blockRoot(key) {
  return host.querySelector(`[data-block-key="${CSS.escape(key)}"]`);
}

// 会改模型状态的三个入口。id 为 null 就是论点那一块。
function applyText(key, id, value) {
  store.session = id ? setArgumentText(store.session, id, value, Date.now())
    : setClaimText(store.session, value, Date.now());
}
function applyOptimized(key, id, value) {
  store.session = id ? setArgumentOptimized(store.session, id, value, Date.now())
    : setClaimOptimized(store.session, value, Date.now());
}
function applyToggle(id, which) {
  store.session = id ? toggleArgumentCheck(store.session, id, which, Date.now())
    : toggleClaimCheck(store.session, which, Date.now());
}

// ---- 定向更新：打字、勾选、加删论证块、优化返回都不重画整页 ----
// 论证块数目是学生自己加的，整块重画会把正在编辑的输入框连同光标一起打掉。

function updateFusionAvailability() {
  const fuse = host.querySelector("#exp-fuse");
  const hint = host.querySelector("#exp-fuse-hint");
  if (!fuse || !hint) return;
  const status = fusionStatus(store.session);
  fuse.disabled = Boolean(busy) || !status.ok;
  fuse.title = status.ok ? "" : status.reason;
  hint.textContent = status.ok ? `将论点与 ${status.count} 个论证块融合成一段。` : status.reason;
}
function updateArgumentCount() {
  const count = host.querySelector("#exp-arg-count");
  if (!count) return;
  const total = store.session.arguments.length;
  count.textContent = total ? `已添加 ${total} 块论证。` : "还没有论证块，点下面的「添加论证」开始。";
}
function renderMessages() {
  const messages = host.querySelector("#exp-messages");
  if (!messages) return;
  messages.replaceChildren();
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
  const warning = node("p", "exp-error", storageFailed ? "本地保存失败，请复制当前内容备份。" : "");
  warning.id = "exp-storage-warning";
  warning.setAttribute("role", "status");
  messages.append(warning);
}
function setBusy() {
  for (const item of host.querySelectorAll("[data-optimize]")) {
    item.disabled = Boolean(busy);
    item.textContent = busy === item.dataset.optimize ? "正在等待 AI…" : "AI 优化";
  }
  // 优化期间锁住所有输入框：这样「点按钮时快照的句子」和「AI 回来时会话里的句子」
  // 不可能不一致。
  for (const area of host.querySelectorAll("textarea.exp-block-input")) area.readOnly = Boolean(busy);
  const cancel = host.querySelector("#exp-cancel-ai");
  if (cancel) cancel.hidden = !busy;
  updateFusionAvailability();
}

// 勾选区同时管两件事：哪些版本可用，以及优化结果长什么样。
function renderChoices(container, block, key, id) {
  container.replaceChildren();
  const hasText = Boolean(block.text.trim());
  const hasOptimized = Boolean(block.optimized.trim());
  // 空的写作块不能勾 —— 这里把它明说出来，而不是给一个不响应的勾。
  if (!hasText && !hasOptimized) {
    container.append(node("p", "hint", "先写下内容，才能勾选用于融合。"));
    return;
  }
  if (hasText) {
    const label = node("label", "exp-choice");
    const input = node("input");
    input.type = "checkbox";
    input.dataset.pick = "text";
    input.checked = block.checkedText;
    input.addEventListener("change", () => {
      applyToggle(id, "text");
      // 按模型回写：目标槽为空时模型会拒绝，勾必须弹回去。
      input.checked = readBlock(store.session, key).checkedText;
      updateFusionAvailability();
      saveSoon();
    });
    label.append(input, node("span", "", "用我写的这句"));
    container.append(label);
  }
  if (hasOptimized) {
    const label = node("label", "exp-choice");
    const input = node("input");
    input.type = "checkbox";
    input.dataset.pick = "optimized";
    input.checked = block.checkedOptimized;
    input.addEventListener("change", () => {
      applyToggle(id, "optimized");
      input.checked = readBlock(store.session, key).checkedOptimized;
      updateFusionAvailability();
      saveSoon();
    });
    label.append(input, node("span", "", "用 AI 优化版"));
    container.append(label, node("p", "exp-optimized-text", block.optimized));
  }
}

// 论点块和论证块结构相同，只有标题、方法说明和「能不能删」不同。
function buildWritingBlock(block, { key, id, title, guide, method, removable }) {
  const root = node("article", "exp-block");
  root.dataset.blockKey = key;
  const head = node("div", "exp-block-head");
  head.append(node("h3", "", title));
  if (method) head.append(node("p", "hint", `${method.name}论证 · ${method.note}`));
  if (removable) head.append(button("", "移除", () => removeBlock(id)));
  root.append(head);
  if (guide) root.append(node("p", "hint", guide));
  const label = node("label", "exp-field", "你写的");
  const editor = node("textarea", "exp-answer exp-block-input");
  editor.rows = 3;
  editor.maxLength = MAX_ANSWER;
  editor.lang = "en";
  editor.spellcheck = true;
  // 值只在这里设一次。定向更新路径下不再写 textarea.value，否则会盖掉正在编辑的内容。
  editor.value = block.text;
  editor.readOnly = Boolean(busy);
  const count = node("p", "hint", `${block.text.length} / ${MAX_ANSWER} 字符 · 草稿自动保存`);
  editor.addEventListener("input", () => {
    applyText(key, id, editor.value);
    count.textContent = `${editor.value.length} / ${MAX_ANSWER} 字符 · 草稿自动保存`;
    // 清空输入框会撤掉这一块的勾，所以勾选区得跟着重画。
    renderChoices(choices, readBlock(store.session, key), key, id);
    updateFusionAvailability();
    saveSoon();
  });
  label.append(editor);
  const actions = node("div", "exp-actions");
  const optimize = button("", "AI 优化", () => optimizeBlock(key));
  optimize.dataset.optimize = key;
  optimize.disabled = Boolean(busy);
  optimize.textContent = busy === key ? "正在等待 AI…" : "AI 优化";
  actions.append(optimize);
  const status = node("p", "hint exp-block-status", errorBlock === key ? error : "");
  const choices = node("div", "exp-choices");
  root.append(label, count, actions, status, choices);
  renderChoices(choices, block, key, id);
  return root;
}

function render() {
  rememberPanels();
  host.replaceChildren();
  const head = node("div", "page-head expansion-head");
  const title = node("div");
  title.append(node("h2", "", "句子扩写练习"),
    node("p", "hint", "IELTS Writing Task 2 · 一句主张，自己丰富、自己论证，再融合成一段。"));
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
  messages.id = "exp-messages";
  host.append(messages);
  renderMessages();
  if (settingsOpen) host.append(renderSettings());
  if (screen === "records") renderRecords();
  else if (!connected && !offline) {
    // 刷新之后 Key 必然没了（它只存内存），所以这一屏每次开页面都会出现。
    // 有草稿就必须说出来 —— 否则用户写完一段一刷新，只看到「先填写 API Key」，
    // 会以为白写了。
    const pending = store.session && !store.session.completed;
    host.append(node("p", "exp-welcome", pending
      ? "你有一份未完成的草稿，已经自动保存。点「先独立练习」接着写，或先连接 AI。"
      : "先填写 API Key 并测试连接，即可使用 AI 优化和融合。也可以先独立练习，稍后再连接。"));
  } else if (picking || !store.session) renderPicker();
  else if (store.session.completed) renderSummary(store.session);
  else renderPractice();
  restorePanels();
}

function renderSettings() {
  const box = node("section", "exp-settings");
  box.append(node("h3", "", "连接你的 AI"),
    node("p", "hint", "默认 DeepSeek Flash。Key 仅在当前页面内存中保留，刷新后需重新填写，不随练习记录保存。"));
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
  const advanced = panel("exp-advanced", "advanced");
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
    destination.textContent = `Key 将直接发送至 ${origin}。AI 优化与融合会发送基础论点、你写的句子，以及你勾选要融合的内容，并使用你的 API 额度。`;
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
      notice = "连接成功。选择一道题开始。";
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
  const wrap = node("label", "exp-inline-label", "主题");
  const select = node("select");
  select.id = "exp-topic";
  for (const item of TOPICS) select.add(new Option(item.name, item.id));
  select.value = topic;
  select.addEventListener("change", () => { topic = select.value; render(); });
  wrap.append(select);
  const topicTasks = EXERCISES.filter((item) => item.topic === topic);
  bar.append(wrap, node("span", "hint", `本主题 ${topicTasks.length} 句 · 共 ${TOPICS.length} 个主题 / ${EXERCISES.length} 句`));
  box.append(bar);
  box.append(node("p", "hint", "按常见雅思大作文题材编排的原创基础论点，供练习论述表达，并非官方真题。"));
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
    const claim = node("p", "exp-english", task.claim);
    claim.prepend(node("span", "exp-question-number", `${String(index + 1).padStart(2, "0")} / ${topicTasks.length}`));
    content.append(claim, node("p", "hint", task.meaning));
    row.append(content, button(`exp-start-${task.id}`, hasDraft ? "替换草稿并开始" : "开始", () => startExercise(task.id)));
    list.append(row);
  }
  box.append(list);
  host.append(box);
}

function startExercise(id) {
  change(() => {
    store.session = newSession(id, sessionId(), Date.now());
    topic = exerciseById(id).topic;
    picking = false;
    screen = "practice";
    save();
  });
  host.querySelector('[data-block-key="claim"] textarea')?.focus();
}

function renderPractice() {
  const session = store.session;
  const task = exerciseById(session.exerciseId);
  const box = node("section", "exp-practice");
  const meta = node("div", "exp-filter-bar");
  meta.append(node("p", "hint", `${TOPICS.find((item) => item.id === task.topic).name} · ${EXERCISES.filter((item) => item.topic === task.topic).length} 句`),
    button("exp-change-exercise", "选择其他题目", () => change(() => { picking = true; })));
  const core = node("div", "exp-core");
  core.append(node("p", "exp-eyebrow", "基础论点 · 不可修改"), node("p", "exp-core-sentence", task.claim),
    node("p", "hint", task.meaning));
  box.append(meta, core);
  box.append(buildWritingBlock(session.claimEdit, { key: CLAIM_KEY, id: null, title: "1 · 丰富论点",
    guide: "用更准确、更正式的词汇改写这句主张，并把句子结构提高一层；立场和意思不变，只写一句。不要加入原因、例子或对比。" }));

  const argsSection = node("section", "exp-args-section");
  argsSection.append(node("h3", "", "2 · 添加论证"),
    node("p", "hint", "可以添加多个论证块，同一种方法也能重复添加。每块独立优化、独立勾选。"));
  const argCount = node("p", "hint");
  argCount.id = "exp-arg-count";
  const args = node("div", "exp-args");
  args.id = "exp-args";
  for (const block of session.arguments) {
    const method = methodById(block.method);
    args.append(buildWritingBlock(block, { key: argKey(block.id), id: block.id,
      title: `${method ? method.name : block.method}论证`, method, removable: true }));
  }
  const addBox = node("details", "exp-add-arg");
  // 不给 data-panel：这是「点开选一个」的临时菜单，每次重画后默认合上正好。
  addBox.append(node("summary", "", "+ 添加论证"));
  const menu = node("div", "exp-method-list");
  for (const method of ARGUMENT_METHODS) {
    const item = button(`exp-method-${method.id}`, "", () => addBlock(method.id));
    item.className = "exp-method";
    item.append(node("strong", "", `${method.name}论证`), node("p", "hint", method.note),
      node("p", "hint", `常用衔接：${method.connectives.join(" / ")}`));
    menu.append(item);
  }
  addBox.append(menu);
  argsSection.append(argCount, args, addBox);
  box.append(argsSection);

  const merge = node("section", "exp-merge");
  const fuseHint = node("p", "hint");
  fuseHint.id = "exp-fuse-hint";
  const mergeActions = node("div", "exp-actions");
  const fuse = button("exp-fuse", "融合成段", () => fuseNow(), true);
  const cancel = button("exp-cancel-ai", "取消请求", () => { cancelRequest("请求已取消，内容已保留。"); render(); });
  cancel.hidden = !busy;
  mergeActions.append(fuse, cancel);
  merge.append(node("h3", "", "3 · 融合成段"), fuseHint, mergeActions,
    node("p", "hint", "勾中的句子按「先论点、再按添加顺序」送给 AI 收成一个段落。用哪一版由你决定；融合之后这次练习就结束了，不打分。"));
  box.append(merge, node("p", "hint", "只在点击按钮时发起请求。优化结果与你写的原句并排显示，可以只勾其中一版，也可以两版都勾。"));
  host.append(box);
  updateArgumentCount();
  updateFusionAvailability();
}

function addBlock(methodId) {
  const id = blockId();
  try { store.session = addArgument(store.session, methodId, id, Date.now()); }
  catch (failure) { error = failure.message; renderMessages(); return; }
  const method = methodById(methodId);
  const root = buildWritingBlock(readBlock(store.session, argKey(id)),
    { key: argKey(id), id, title: `${method.name}论证`, method, removable: true });
  // 只把新块插到列表末尾，别的块是同一个 DOM 对象，不参与重画 —— 它们的文字和光标都留着。
  host.querySelector("#exp-args").append(root);
  host.querySelector(".exp-add-arg").open = false;
  save();
  updateArgumentCount();
  updateFusionAvailability();
  root.querySelector("textarea").focus();
}

function removeBlock(id) {
  store.session = removeArgument(store.session, id, Date.now());
  blockRoot(argKey(id))?.remove();
  save();
  updateArgumentCount();
  updateFusionAvailability();
  const left = host.querySelectorAll("[data-block-key^='argument:']");
  const target = left.length ? left[left.length - 1] : blockRoot(CLAIM_KEY);
  target?.querySelector("textarea")?.focus();
}

function openSettingsForAi() {
  settingsOpen = true;
  notice = "先测试连接，再使用 AI。当前内容已经保留。";
  render();
  document.getElementById("exp-api-key")?.focus();
}

async function optimizeBlock(key) {
  if (busy) return;
  if (!connected) { openSettingsForAi(); return; }
  const block = readBlock(store.session, key);
  const invalid = answerError(block?.text);
  if (invalid) {
    error = invalid;
    errorBlock = key;
    renderMessages();
    syncBlock(key);
    blockRoot(key)?.querySelector("textarea")?.focus();
    return;
  }
  const session = store.session;
  const id = argIdOf(key);
  const snapshot = block.text;          // 「当时框里的文字」
  const token = ++requestSerial;
  controller = new AbortController();
  busy = key;
  error = "";
  errorBlock = "";
  renderMessages();
  setBusy();
  try {
    const exercise = exerciseById(session.exerciseId);
    const optimized = id
      ? await requestArgumentOptimization(config, exercise, methodById(block.method), snapshot, { signal: controller.signal })
      : await requestClaimOptimization(config, exercise, snapshot, { signal: controller.signal });
    // 只让取消、换页、换题作废 —— 优化只写 optimized 这一个槽，期间打字不该丢掉结果。
    if (token !== requestSerial) return;
    applyOptimized(key, id, optimized);
    save();
  } catch (failure) {
    if (token !== requestSerial) return;
    if (failure.name !== "AbortError") { error = failure.message; errorBlock = key; }
  } finally {
    if (token === requestSerial) {
      busy = null;
      controller = null;
      renderMessages();
      syncBlock(key);
      updateFusionAvailability();
    }
  }
}

// 单块同步：只重建这一块的勾选区、刷状态行与按钮，绝不写 textarea.value。
function syncBlock(key) {
  const root = blockRoot(key);
  if (!root) return;
  const block = readBlock(store.session, key);
  if (!block) return;
  const id = argIdOf(key);
  const choices = root.querySelector(".exp-choices");
  if (choices) renderChoices(choices, block, key, id);
  const status = root.querySelector(".exp-block-status");
  if (status) status.textContent = errorBlock === key ? error : "";
  const optimize = root.querySelector("[data-optimize]");
  if (optimize) {
    optimize.disabled = Boolean(busy);
    optimize.textContent = busy === key ? "正在等待 AI…" : "AI 优化";
  }
  const area = root.querySelector("textarea");
  if (area) area.readOnly = Boolean(busy);
}

async function fuseNow() {
  const status = fusionStatus(store.session);
  if (busy || !status.ok) return;
  if (!connected) { openSettingsForAi(); return; }
  const session = store.session;
  const parts = fusionPayload(session);      // 点按即快照，不受后续编辑影响
  const token = ++requestSerial;
  controller = new AbortController();
  busy = "fusion";
  error = "";
  errorBlock = "";
  renderMessages();
  setBusy();
  try {
    const paragraph = await requestFusion(config, exerciseById(session.exerciseId), parts, { signal: controller.signal });
    if (token !== requestSerial) return;
    store.session = fuseSession(store.session, paragraph, Date.now());
    store.records = recordCompleted(store.records, store.session);
    save();
  } catch (failure) {
    if (token !== requestSerial) return;
    if (failure.name !== "AbortError") error = failure.message;
  } finally {
    if (token === requestSerial) {
      busy = null;
      controller = null;
      render();      // 成功就进总结页；失败时练习页原样重画，已写内容都还在
    }
  }
}

function renderSummary(session, container = host) {
  const task = exerciseById(session.exerciseId);
  const box = node("section", "exp-summary");
  const usedAi = session.claimEdit.usedAi || session.arguments.some((item) => item.usedAi);
  box.append(node("h3", "", "从一句主张，到一个段落"), node("p", "exp-eyebrow", "基础论点"),
    node("p", "exp-english", task.claim), node("p", "exp-eyebrow", "融合后的段落"),
    node("p", "exp-paragraph", session.fusion),
    node("p", "hint", `${usedAi ? "本题使用过 AI 优化" : "本题未使用 AI 优化"} · ${new Date(session.updatedAt).toLocaleString("zh-CN")}`));
  const review = panel("exp-review", `review-${session.id}`);
  review.append(node("summary", "", "回顾论点与每条论证"));
  const claim = node("section", "exp-review-step");
  claim.append(node("h4", "", "丰富后的论点"), node("p", "exp-english", session.claimEdit.text || "（没有写）"));
  if (session.claimEdit.optimized) claim.append(node("p", "exp-optimized-text", `AI 优化：${session.claimEdit.optimized}`));
  review.append(claim);
  for (const block of session.arguments) {
    const method = methodById(block.method);
    const step = node("section", "exp-review-step");
    step.append(node("h4", "", `${method ? method.name : block.method}论证`),
      node("p", "exp-english", block.text || "（没有写）"));
    if (block.optimized) step.append(node("p", "exp-optimized-text", `AI 优化：${block.optimized}`));
    review.append(step);
  }
  box.append(review);
  const actions = node("div", "exp-actions");
  actions.append(button("", "重练这一题", () => startExercise(task.id)),
    button("", "选择下一题", () => change(() => { screen = "practice"; picking = true; })));
  box.append(actions);
  container.append(box);
}

function renderRecords() {
  const box = node("section", "exp-records");
  box.append(node("p", "hint", "只保存在当前浏览器。这里保留基础论点、你的论点改写、每条论证的原稿与 AI 优化稿，以及融合后的段落，不保存 API Key。"));
  if (!store.records.length) box.append(node("p", "exp-welcome", "还没有完成的段落。写完论点、加两条论证并融合之后，会自动保存在这里。"));
  for (const record of store.records) {
    const task = exerciseById(record.exerciseId);
    const details = panel("exp-record", `record-${record.id}`);
    details.append(node("summary", "", `${task.claim} · ${new Date(record.updatedAt).toLocaleDateString("zh-CN")}`));
    renderSummary(record, details);
    box.append(details);
  }
  host.append(box);
}

function enter() {
  View.setHeading("句子扩写练习", "一句主张，自己丰富、自己论证，再融合成一段。");
  View.show("expansion");
  render();
}

View.register("expansion", enter, () => { cancelRequest(); save(); render(); });
