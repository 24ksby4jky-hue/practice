// 读书页：foliate-view 的宿主，外加我们自己的那圈界面（目录、进度、排版）。
//
// 引擎用 foliate-js（MIT，见 vendor/foliate/LICENSE），vendored 在
// ./vendor/foliate/。它是原生 ES 模块，import 进来就会注册 <foliate-view>
// 这个自定义元素。
//
// 分页不是它自己算的排版：每个分节一个 iframe，里面用 CSS 多栏
// （column-width + column-gap）+ 定高容器 + translateX 翻页。
// 所以尺寸必须由外面给足 —— 容器高度是 0 的话它会一片空白。
//
// 书的内容在 iframe 里、有它自己的 CSS；我们自己那圈界面照旧是纸面 + 印线 +
// 墨色选中，红色只用于批改。
import { makeBook } from "./vendor/foliate/view.js";
// 这两个 view.js 已经静态引了，跟着引不会多出一个 chunk；search.js 是懒加载的，
// 所以下面用到它的时候才 import（和 view.js 自己的做法一致）。
import { Overlayer } from "./vendor/foliate/overlayer.js";
import { textWalker } from "./vendor/foliate/text-walker.js";
import * as View from "../view.js";
import { showToast } from "../typing/app.js";
import * as TypingModel from "../typing/typing-model.js";
import * as Model from "./reading-model.js";
import { createWorkspace } from "./workspace.js";

// 搜索一次最多收这么多处。一个常见词在大部头里能有几千处，全渲染出来
// 只会让面板卡住 —— 到头了就停，并说清楚是「前 N 处」。
const SEARCH_LIMIT = 200;

// 结果高亮用墨，不用红 —— 红在这个应用里只表示批改。
//
// 这也是这里没用 foliate 现成的 view.search() 的唯一原因：它把每条结果都画成
// Overlayer.outline 的默认色，而那个默认色是 'red'。宁可用它更底层的
// searchMatcher（切词、分词、抽取上下文那些还是它做），自己画这一笔。
const HIGHLIGHT_COLOR = "#14161c";

let view = null;
let workspace = null;
let pdfReader = null;
let openedBook = null;
let openToken = 0;
let position = null;
// 当前这本书的身份和显示名。身份用来给进度选 localStorage 的键。
let currentId = null;
let currentLabel = "";
// 当前排版（对象）和打开的浮层（"toc" / "search" / "type" / null）
let settings = null;
let panel = null;
// 搜索。结果留在 searchState 里，关掉面板再打开还在；searchToken 用来叫停
// 上一次还没扫完的搜索（换一本书、或者又搜了一次）。
let searchState = null;
let searchToken = 0;
let highlightedCfi = null;
// 朗读：listening 开着的时候点句子才读；speech 里只有语速。
let listening = false;
let speech = Model.readSpeech(null);

const el = (id) => document.getElementById(id);

function button(id, text, className, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.id = id;
  node.textContent = text;
  if (className) node.className = className;
  node.addEventListener("click", onClick);
  return node;
}

/* --------------------------------------------------------------------------
   画页面
   -------------------------------------------------------------------------- */

function layout() {
  const host = el("reader-view");
  host.textContent = "";

  const bar = document.createElement("div");
  bar.className = "reader-bar";

  const pos = document.createElement("span");
  pos.className = "reader-pos";
  pos.id = "reader-pos";

  bar.append(
    pos,
    button("reader-toc", "目录", "reader-tool", () => workspace?.selectTab("toc")),
    button("reader-search", "搜索", "reader-tool", () => togglePanel("search")),
    button("reader-speak", "朗读", "reader-tool", () => togglePanel("tts")),
    button("reader-type", "排版", "reader-tool", () => togglePanel("type")),
    button("reader-prev", "上一页", "reader-tool", () => turn(-1)),
    button("reader-next", "下一页", "reader-tool", () => turn(1))
  );
  // init() 完成之前分页器还持有导航锁，过早点击会被它静默丢弃。
  for (const control of bar.querySelectorAll("button")) control.disabled = true;

  // 进度：一条印线，读过的那段用墨填。不是红色 —— 红只用来批改。
  const progress = document.createElement("div");
  progress.className = "reader-progress";
  progress.id = "reader-progress";
  const fill = document.createElement("span");
  fill.className = "reader-progress-fill";
  fill.id = "reader-progress-fill";
  progress.append(fill);

  const panelBox = document.createElement("div");
  panelBox.className = "reader-panel";
  panelBox.id = "reader-panel";
  panelBox.hidden = true;

  const stage = document.createElement("div");
  stage.className = "reader-stage";
  stage.id = "reader-stage";

  workspace = createWorkspace(host, { title: currentLabel, toolbar: bar, stage, overlay: panelBox,
    onPages: paintBookPages, onToc: paintToc });
  workspace.shell.append(progress);
}

function paintBookPages(box) {
  if (!view?.book) { box.append(hint("正在打开电子书…")); return; }
  box.append(hint("电子书会随字号与窗口尺寸重新分页，以下按分节定位。"));
  const count = view.renderer?.pages || 0;
  if (count) box.append(hint(`当前分节 · 第 ${Math.min(count, (view.renderer?.page || 0) + 1)} / ${count} 屏`));
  const label = document.createElement("label");
  label.className = "reader-hint reader-location-label";
  label.textContent = "全书进度";
  const range = document.createElement("input");
  range.type = "range"; range.min = "0"; range.max = "100";
  range.value = String(Math.round(position ? bookFraction(position) * 100 : 0));
  range.addEventListener("change", () => { void view.goToFraction(Number(range.value) / 100).catch(() => showToast("无法跳转到该位置")); });
  label.append(range); box.append(label);
  view.book.sections.forEach((section, index) => {
    if (section.linear === "no") return;
    const item = button(`reader-section-${index}`, `${index + 1}. ${sectionLabel(index) || "分节"}`, "toc-item", () => { void view.goTo(index); });
    item.classList.toggle("current", position?.section?.current === index);
    box.append(item);
  });
}

function togglePanel(which) {
  const was = panel;
  panel = panel === which ? null : which;
  // 关掉搜索面板就把书里那笔高亮收掉；点结果跳过去时面板也会收，
  // 但那条路走的是 goToResult，不经过这里，所以高亮留得住。
  if (was === "search" && panel !== "search") clearHighlight();
  // 离开朗读就闭嘴 —— 面板是唯一的开关，关掉它必须把声音也带走
  listening = panel === "tts";
  if (!listening) stopSpeech();
  paintPanel();
}

function paintPanel() {
  const box = el("reader-panel");
  if (!box) return;
  box.hidden = panel === null;
  box.textContent = "";
  const PANELS = [
    ["reader-toc", "toc"], ["reader-search", "search"],
    ["reader-speak", "tts"], ["reader-type", "type"]
  ];
  for (const [id, which] of PANELS) {
    const node = el(id);
    if (node) node.classList.toggle("active", panel === which);
  }

  if (panel === "toc") paintToc(box);
  else if (panel === "search") paintSearch(box);
  else if (panel === "tts") paintSpeech(box);
  else if (panel === "type") paintTypography(box);
}

function hint(text) {
  const line = document.createElement("p");
  line.className = "reader-hint";
  line.textContent = text;
  return line;
}

/* --------------------------------------------------------------------------
   目录
   -------------------------------------------------------------------------- */

function paintToc(box) {
  const entries = Model.tocEntries(view && view.book ? view.book.toc : null);
  if (!entries.length) {
    box.append(hint("这本书没有目录。"));
    return;
  }
  const current = currentChapterHref();
  const list = document.createElement("div");
  list.className = "toc-list";
  for (const entry of entries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "toc-item";
    // 缩进交给 CSS，层级来自目录本身的嵌套深度
    item.style.setProperty("--depth", String(entry.depth));
    item.textContent = entry.label;
    if (current && sameTarget(current, entry.href)) item.classList.add("current");
    item.addEventListener("click", () => goToEntry(entry.href));
    list.append(item);
  }
  box.append(list);
}

// relocate 给的 tocItem 是当前所在的那一条。
function currentChapterHref() {
  const item = position && position.tocItem;
  if (!item) return null;
  return typeof item.href === "string" && item.href ? item.href : null;
}

// 目录里的 href 和 tocItem 给的可能是同一个目标的两种写法（带不带锚点、
// 有没有 ./）。松一点比，别因为一个字符就标不上当前章。
function sameTarget(a, b) {
  if (a === b) return true;
  if (a.includes("#") && b.includes("#")) return a.replace(/^\.\//, "") === b.replace(/^\.\//, "");
  const strip = (href) => href.replace(/^\.\//, "").replace(/#.*$/, "");
  return strip(a) === strip(b);
}

async function goToEntry(href) {
  if (!view) return;
  panel = null;
  paintPanel();
  await view.goTo(href);
}

/* --------------------------------------------------------------------------
   排版
   -------------------------------------------------------------------------- */

function paintTypography(box) {
  box.append(
    optionRow("字号", Model.FONT_SIZES, settings.size, (value) => setSetting("size", value),
      (value) => `${value}`),
    optionRow("行高", Model.LINE_HEIGHTS, settings.lineHeight, (value) => setSetting("lineHeight", value),
      (value) => `${value}`),
    optionRow("页边距", Model.MARGINS, settings.margin, (value) => setSetting("margin", value),
      (value) => `${value}`),
    optionRow("纸色", Object.keys(Model.THEMES), settings.theme, (value) => setSetting("theme", value),
      (value) => Model.THEMES[value].name)
  );
}

function optionRow(label, values, current, onPick, format) {
  const row = document.createElement("div");
  row.className = "type-row";
  const name = document.createElement("span");
  name.className = "type-label";
  name.textContent = label;
  row.append(name);
  for (const value of values) {
    const item = button("", format(value), "type-option", () => onPick(value));
    if (value === current) item.classList.add("active");
    row.append(item);
  }
  return row;
}

function setSetting(key, value) {
  settings = Model.readTypography({ ...settings, [key]: value });
  // 这是用户明确点出来的一下，存不下就该说一声
  if (!TypingModel.writeJson(localStorage, Model.TYPOGRAPHY_KEY, settings)) {
    showToast("排版设置没能保存");
  }
  applyTypography();
  // 重画一遍：按钮的选中态要跟着走
  paintPanel();
}

// 三件事，缺一条就会有「改了没反应」的地方：
//   1. 页边距是渲染器在外面排的，改属性才会重排；
//   2. 已经渲染出来的 iframe 要就地换掉那支 <style>；
//   3. 还没加载的分节靠 openBook 里挂的那个 data 监听，加载时自己带上新样式。
function applyTypography() {
  if (!view) return;
  const renderer = view.renderer;
  if (renderer) {
    const attributes = Model.rendererAttributes(settings);
    for (const [name, value] of Object.entries(attributes)) {
      renderer.setAttribute(name, value);
    }
  }
  const css = Model.typographyCss(settings);
  for (const { doc } of contentsOf()) paintDoc(doc, css);
}

function contentsOf() {
  const renderer = view && view.renderer;
  if (!renderer || typeof renderer.getContents !== "function") return [];
  try {
    return renderer.getContents() || [];
  } catch {
    return [];
  }
}

// 已经渲染出来的分节：找到那支样式就地改，没有就建一支。
// 换字号不用重开书，也不用等分节重新加载。
function paintDoc(doc, css) {
  if (!doc || !doc.head) return;
  let style = doc.getElementById(Model.STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = Model.STYLE_ID;
    doc.head.append(style);
  }
  style.textContent = css;
}

/* --------------------------------------------------------------------------
   搜索
   -------------------------------------------------------------------------- */

function paintSearch(box) {
  const state = searchState || { query: "", status: "", results: [] };

  const form = document.createElement("form");
  form.className = "search-bar";
  const input = document.createElement("input");
  input.type = "search";
  input.id = "search-input";
  input.placeholder = "在书里找…";
  input.value = state.query;
  const go = document.createElement("button");
  go.type = "submit";
  go.id = "search-go";
  go.textContent = "搜索";
  form.append(input, go);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query) runSearch(query);
  });
  box.append(form);

  const status = document.createElement("p");
  status.className = "reader-hint";
  status.id = "search-status";
  status.textContent = state.status;
  box.append(status);

  const list = document.createElement("div");
  list.className = "search-list";
  list.id = "search-list";
  for (const group of state.results) list.append(resultGroup(group));
  box.append(list);
}

function resultGroup(group) {
  const wrap = document.createElement("div");
  wrap.className = "search-group";
  if (group.label) {
    const head = document.createElement("p");
    head.className = "search-chapter";
    head.textContent = group.label;
    wrap.append(head);
  }
  for (const item of group.items) wrap.append(resultItem(item));
  return wrap;
}

function resultItem(item) {
  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "search-hit";
  // 摘要是切好的三段：命中那截单独标出来
  const { pre, match, post } = Model.parseExcerpt(item.excerpt);
  if (pre) hit.append(span("search-pre", pre));
  hit.append(span("search-match", match));
  if (post) hit.append(span("search-post", post));
  hit.addEventListener("click", () => goToResult(item));
  return hit;
}

function span(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function sectionLabel(index) {
  try {
    const found = view.getProgressOf(index);
    return (found && found.tocItem && found.tocItem.label) || "";
  } catch {
    return "";
  }
}

// 整本扫一遍。foliate 的 view.search() 也是这个套路，只是它会顺手把每条结果
// 画成红色；这里只要它底层的 searchMatcher —— 切词、大小写、抽取上下文
// 都还是它做，我们只管把结果摆出来、画一笔。
async function runSearch(query) {
  const token = ++searchToken;
  searchState = { query, status: "正在搜索…", results: [] };
  paintPanel();

  const { searchMatcher } = await import("./vendor/foliate/search.js");
  if (token !== searchToken) return;

  const matcher = searchMatcher(textWalker, {
    defaultLocale: view.language,
    matchCase: false,
    matchDiacritics: false,
    matchWholeWords: false,
    mode: "contains"
  });

  const sections = view.book.sections;
  let total = 0;

  for (const [index, section] of sections.entries()) {
    if (token !== searchToken) return;
    if (typeof section.createDocument !== "function") continue;

    const items = [];
    try {
      const doc = await section.createDocument();
      for (const match of matcher(doc, query)) {
        items.push({ cfi: view.getCFI(index, match.range), excerpt: match.excerpt });
        // 到头了就停，别再往下扫 —— 再扫也不会显示
        if (++total >= SEARCH_LIMIT) break;
      }
    } catch {
      // 单独一份分节解不开或搜不动，不该毁掉整次搜索
    }
    if (token !== searchToken) return;

    if (items.length) {
      const group = { index, label: sectionLabel(index), items };
      searchState.results.push(group);
      // 扫到一章就贴一章：大部头扫完要好一会儿，中途什么都不出会让人以为卡死了
      const list = el("search-list");
      if (list) list.append(resultGroup(group));
    }
    searchState.status = total >= SEARCH_LIMIT
      ? `已找到 ${SEARCH_LIMIT} 处，先显示这些`
      : `已找到 ${total} 处…`;
    const status = el("search-status");
    if (status) status.textContent = searchState.status;
    if (total >= SEARCH_LIMIT) break;
  }

  if (token !== searchToken) return;
  searchState.status = total ? `共 ${total} 处` : `没找到「${query}」。`;
  paintPanel();
}

async function goToResult(item) {
  if (!view) return;
  // 面板收起来，但高亮留着 —— 跳过去就是为了看见它在哪
  panel = null;
  paintPanel();
  await view.goTo(item.cfi);
  highlightResult(item.cfi);
}

// 用 foliate 的标注层画一条墨色下划线。标注层是 iframe 上的 SVG，不碰书里的
// DOM，所以不会引发重排 —— 这点对读书页很要紧（包装节点改 DOM 就得重新分页）。
function highlightResult(cfi) {
  if (!view) return;
  clearHighlight();
  highlightedCfi = cfi;
  try {
    view.addAnnotation({ value: cfi });
  } catch {
    // 画不上就算了，位置已经跳过去了，不值得为一条下划线报错
    highlightedCfi = null;
  }
}

function clearHighlight() {
  if (!view || !highlightedCfi) return;
  try {
    view.deleteAnnotation({ value: highlightedCfi });
  } catch {
    // 那一节可能已经不在屏幕上了
  }
  highlightedCfi = null;
}

/* --------------------------------------------------------------------------
   朗读
   用 Web Speech（speechSynthesis），不是 foliate 的 tts.js —— 后者产出的是
   SSML 字符串，等着喂给会认 SSML 的引擎，而浏览器这个 API 要的是纯文本。
   分句还是借它的 getSentences（Intl.Segmenter 切的，比自己写正则稳）。
   -------------------------------------------------------------------------- */

// 每一份分节的句子表，按文档缓存一次 —— 点一下就要能立刻出声，
// 不能每次点击都重切一遍整章。
const sentenceCache = new WeakMap();

// tts.js 在 view.js 里是懒加载的，跟着懒加载就不会把它并进主 chunk。
// 只有真的开了朗读才会拉进来。
let getSentencesFn = null;

async function loadSentences() {
  if (!getSentencesFn) {
    const mod = await import("./vendor/foliate/tts.js");
    getSentencesFn = mod.getSentences;
  }
  return getSentencesFn;
}

function sentencesOf(doc, getSentences) {
  const cached = sentenceCache.get(doc);
  if (cached) return cached;
  const list = [];
  try {
    for (const { range } of getSentences(doc, textWalker, null, "sentence")) {
      if (range.toString().trim()) list.push(range);
    }
  } catch {
    // 切不动就当这节没有句子，别把点击事件整个炸掉
  }
  sentenceCache.set(doc, list);
  return list;
}

function sentenceAt(doc, node, offset, getSentences) {
  for (const range of sentencesOf(doc, getSentences)) {
    try {
      if (range.comparePoint(node, offset) === 0) return range;
    } catch {
      // 点在另一棵树里的节点上 —— comparePoint 会抛，跳过
    }
  }
  return null;
}

// 文档里的点击落到哪个字符位置。Chrome 有 caretRangeFromPoint，
// Firefox 是标准的 caretPositionFromPoint。
function caretPoint(doc, event) {
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(event.clientX, event.clientY);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(event.clientX, event.clientY);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  return null;
}

// onboundary 给的 charIndex 是相对整句文字的（也就是说，相对 range.toString()）。
// 逐词高亮要把这个偏移切回一个真能画出来的 Range。
function sliceRange(range, start, end) {
  const container = range.commonAncestorContainer;
  const root = container.nodeType === 3 ? container.parentNode : container;
  if (!root) return null;
  const doc = root.ownerDocument || root;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const out = doc.createRange();
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    try {
      if (!range.intersectsNode(node)) continue;
    } catch {
      continue;
    }
    const length = node.nodeValue.length;
    const from = seen;
    const to = seen + length;
    seen = to;
    if (!started && end > from) {
      out.setStart(node, Math.max(0, Math.min(length, start - from)));
      started = true;
    }
    if (started && end <= to) {
      out.setEnd(node, Math.max(0, Math.min(length, end - from)));
      return out;
    }
  }
  return null;
}

// 没有 charLength 的实现（Safari 就没有）按字母往后扫到一个词的末尾。
function wordEnd(text, start) {
  let end = start;
  while (end < text.length && /[A-Za-z'’-]/.test(text[end])) end += 1;
  return end === start ? Math.min(text.length, start + 1) : end;
}

function indexOfDoc(doc) {
  const found = contentsOf().find((content) => content.doc === doc);
  return found ? found.index : null;
}

function speakSentence(doc, range) {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== "function") {
    showToast("这个浏览器没有朗读功能");
    return;
  }
  window.speechSynthesis.cancel();
  const text = range.toString();
  if (!text.trim()) return;

  const index = indexOfDoc(doc);
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = speech.rate;
  const lang = doc.documentElement.getAttribute("lang");
  if (lang) utter.lang = lang;

  // 逐词高亮：只认 word 这一类 boundary，句首句尾那些不算
  utter.onboundary = (event) => {
    if (event.name && event.name !== "word") return;
    const start = event.charIndex;
    const end = start + (event.charLength || wordEnd(text, start) - start);
    if (index === null) return;
    const wordRange = sliceRange(range, start, end);
    if (!wordRange) return;
    highlightResult(view.getCFI(index, wordRange));
  };
  utter.onend = () => clearHighlight();
  utter.onerror = () => clearHighlight();

  window.speechSynthesis.speak(utter);
}

function stopSpeech() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  clearHighlight();
}

function paintSpeech(box) {
  box.append(hint("点书里的一句话，从那儿读起；再点一句就换成那一句。"));
  box.append(optionRow("语速", Model.SPEECH_RATES, speech.rate,
    (value) => setSpeech(value), (value) => `${value}`));
  const stop = document.createElement("button");
  stop.type = "button";
  stop.id = "speech-stop";
  stop.textContent = "停";
  stop.addEventListener("click", stopSpeech);
  box.append(stop);
}

function setSpeech(rate) {
  speech = Model.readSpeech({ ...speech, rate });
  if (!TypingModel.writeJson(localStorage, Model.SPEECH_KEY, speech)) {
    showToast("语速没能保存");
  }
  paintPanel();
}

// 每份分节第一次渲染出来时挂上监听。挂在文档上而不是元素上 ——
// 句子的边界和段落边界不是一回事。
function listenInDoc(doc) {
  if (!doc || doc.__readerListen) return;
  doc.__readerListen = true;
  workspace?.bindWords(doc, doc, () => !listening);
  doc.addEventListener("click", async (event) => {
    if (!listening) return;
    // 用户正在选文字，别抢这一下
    const selection = doc.getSelection ? doc.getSelection() : null;
    if (selection && !selection.isCollapsed) return;
    const point = caretPoint(doc, event);
    if (!point) return;
    const getSentences = await loadSentences();
    // 等模块的这一小会儿里可能已经关掉朗读了
    if (!listening) return;
    const range = sentenceAt(doc, point.node, point.offset, getSentences);
    if (!range) return;
    event.preventDefault();
    speakSentence(doc, range);
  });
  // 点过书之后焦点就进 iframe 了，那边的按键到不了外面的 document，
  // 所以每一份分节里也要挂一份方向键。
  doc.addEventListener("keydown", onKeyDown);
}

/* --------------------------------------------------------------------------
   键盘翻页
   -------------------------------------------------------------------------- */

// 挂在 document 上一次就够 —— 这个模块只求值一次（和 typing/app.js 一样，
// 在模块求值时就把它自己准备好）。真正管事的是函数里那几道判断。
if (typeof document !== "undefined") {
  document.addEventListener("keydown", onKeyDown);
}

function onKeyDown(event) {
  if (!view && !pdfReader) return;
  // 只有读书页在屏幕上的时候才管 —— 别的页面上左右键各有各的用处
  if (document.body.dataset.view !== "reader") return;
  // 带修饰键的组合是浏览器/系统的，不碰
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const delta = Model.pageKey(event.key);
  if (!delta) return;
  // 焦点在搜索框里的时候左右键是移光标，不是翻页
  const target = event.target;
  if (target && target.nodeType === 1
    && Model.swallowsKeys(target.tagName, target.isContentEditable)) return;
  event.preventDefault();
  turn(delta);
}

/* --------------------------------------------------------------------------
   位置
   -------------------------------------------------------------------------- */

// 整本书的进度。
//
// 注意别用 relocate 事件里的 detail.index —— 那是 paginator 的页/单元索引，
// 不是节索引，直接当「第几节」显示是错的。真实位置在 lastLocation 里：
//   section: { current, total }      当前第几节（current 从 0 数）
//   fraction                         本节内的比例，翻到边界时会略微超过 1
//   tocItem.label                    当前章节名
// getSectionFractions() 给的是每节的累计起点，3 节 → [0, .348, .675, 1]，
// 所以整本书进度 = 本节起点 + 本节内比例 × 本节长度。
function bookFraction(loc) {
  const index = loc.section ? loc.section.current : 0;
  const within = Math.min(1, Math.max(0, loc.fraction || 0));
  const bounds = view && typeof view.getSectionFractions === "function" ? view.getSectionFractions() : null;
  if (!bounds || bounds.length < 2 || typeof bounds[index] !== "number") return within;
  const start = bounds[index];
  const end = typeof bounds[index + 1] === "number" ? bounds[index + 1] : 1;
  return Math.min(1, Math.max(0, start + (end - start) * within));
}

function paintPosition(loc) {
  const box = el("reader-pos");
  const bar = el("reader-progress-fill");
  if (!loc) {
    if (box) box.textContent = "";
    if (bar) bar.style.width = "0%";
    return;
  }
  const fraction = bookFraction(loc);
  if (bar) bar.style.width = `${Math.round(fraction * 100)}%`;
  if (!box) return;
  const label = loc.tocItem && loc.tocItem.label ? loc.tocItem.label : "";
  const total = loc.section ? loc.section.total : 0;
  const current = loc.section ? loc.section.current + 1 : 0;
  const percent = Math.round(fraction * 100);
  const where = total ? `${current}/${total}` : "";
  box.textContent = [label, where, `${percent}%`].filter(Boolean).join(" · ");
}

// 翻一页就落一次盘。进度是顺手的记录，存不下（无痕模式、配额满）不该打断
// 阅读，所以这里不弹提示 —— 和「排版设置」那一下不一样，那是用户明确点的。
function saveProgress(loc) {
  if (!currentId || !loc) return;
  // 读书页被藏起来的时候（去了首页、生词本、书架…）容器是尺寸 0，
  // foliate 的 paginator 会在里面重新分页一次，位置被冲回节首，并且**照常
  // 报一次 relocate**。那不是用户读到的地方，存下去就等于「去趟首页，
  // 进度退到本章开头」。回到读书页它自己会再报一次正确的位置，
  // 所以这里只管不写，不用做别的。
  if (document.body.dataset.view !== "reader") return;
  const value = Model.parseProgress({ fraction: bookFraction(loc), cfi: loc.cfi });
  TypingModel.writeJson(localStorage, Model.progressKey(currentId), value);
}

export function turn(delta) {
  if (pdfReader) { pdfReader.turn(delta); return; }
  if (!view) return;
  if (delta > 0) view.next();
  else view.prev();
}

export function closeBook() {
  openToken += 1;
  workspace?.close();
  workspace = null;
  pdfReader?.close();
  pdfReader = null;
  if (view) {
    try {
      view.close();
    } catch {
      // 关不干净不影响后面重开
    }
    view.remove();
    view = null;
  }
  openedBook?.destroy?.();
  openedBook = null;
  position = null;
  currentId = null;
  panel = null;
  // 上一次的搜索结果不该跟到下一本书里；searchToken 加一，
  // 让还没扫完的那次搜索下一次循环就自己退出
  searchState = null;
  searchToken += 1;
  highlightedCfi = null;
  // 书关了就别再出声，也别再等一次点击
  listening = false;
  stopSpeech();
  const stage = el("reader-stage");
  if (stage) stage.textContent = "";
}

/* --------------------------------------------------------------------------
   打开
   -------------------------------------------------------------------------- */

// 能不能拿 CFI 去恢复位置。resolveNavigation 解析不了会返回 undefined，
// 那就退回按比例恢复，别把用户扔回第一页。
function canResolve(candidate) {
  if (!candidate || !view || typeof view.resolveNavigation !== "function") return false;
  try {
    return Boolean(view.resolveNavigation(candidate));
  } catch {
    return false;
  }
}

function isHtmlType(type) {
  return typeof type === "string"
    && (type.indexOf("application/xhtml+xml") === 0 || type.indexOf("text/html") === 0);
}

// 书的资源在装载时从这里过一道：
//   · HTML 分节 —— 把排版样式插进 <head> 末尾，让后面才加载的分节也带上；
//   · 脚本 —— 一律拦掉。
//
// 脚本那条是安全线，不是性能优化：EPUB 里的 JavaScript 是真实的攻击面，
// 而这是个只读本地书的应用，没有任何东西需要它。foliate 的 README 也在
// 反复提醒这件事。拦掉之后书里的交互脚本不会跑，这是有意的取舍。
function watchResources(book) {
  const target = book && book.transformTarget;
  if (!target || typeof target.addEventListener !== "function") return;

  target.addEventListener("load", (event) => {
    if (event.detail && event.detail.isScript) event.detail.allow = false;
  });

  target.addEventListener("data", (event) => {
    const detail = event.detail;
    if (!detail || !isHtmlType(detail.type)) return;
    const css = Model.typographyCss(settings);
    // detail.data 可能是个 Promise，也可能已经是字符串 —— 两种都要接住
    detail.data = Promise.resolve(detail.data).then((html) => Model.injectStyleTag(html, css));
  });
}

// source 可以是 File / Blob，也可以是可以 fetch 的 URL。
// id 是这本书的身份（见 reading-model 的 bookId）—— 进度存在它名下。
export async function openBook(source, label, id) {
  closeBook();
  const token = openToken;
  const extension = Model.extensionOf(source?.name);
  if (extension === "pdf") {
    const { createPdfReader } = await import("./pdf-reader.js");
    if (token !== openToken) return false;
    const reader = createPdfReader(el("reader-view"), label || source.name, id);
    pdfReader = reader;
    return reader.open(source);
  }
  currentId = id || null;
  currentLabel = label || "";
  layout();
  settings = Model.readTypography(localStorage.getItem(Model.TYPOGRAPHY_KEY));
  speech = Model.readSpeech(localStorage.getItem(Model.SPEECH_KEY));
  listening = false;

  const stage = el("reader-stage");
  const title = el("reader-title");
  if (title) title.textContent = currentLabel;

  view = document.createElement("foliate-view");
  view.addEventListener("relocate", (event) => {
    if (token !== openToken) return;
    position = event.detail || null;
    paintPosition(position);
    saveProgress(position);
    workspace?.position(el("reader-pos")?.textContent || "");
    workspace?.refresh();
    // 「当前读到哪一章」那条高亮跟着走，但只有目录开着时才值得重画
    if (panel === "toc") paintPanel();
  });
  // relocate 比首次渲染晚一拍，刚打开时读数会是空的 —— 分节载入时先亮一下，
  // 等 relocate 到了再补上章节名和真实进度。
  view.addEventListener("load", (event) => {
    if (token !== openToken) return;
    if (!position) paintPosition({ fraction: 0, section: null, tocItem: null });
    // 兜底：injectStyleTag 找不到 <head> 时没插进去，这里用 DOM 补上
    const css = Model.typographyCss(settings);
    for (const { doc } of contentsOf()) {
      paintDoc(doc, css);
      // 朗读是点句子的，所以每份分节都要挂上点击
      listenInDoc(doc);
    }
  });
  // 书里的链接不跳走，免得把整个应用替换掉
  view.addEventListener("external-link", (event) => event.preventDefault());
  // 标注层问我们要怎么画。只画我们自己加的那一笔，颜色用墨不用红。
  view.addEventListener("draw-annotation", (event) => {
    const draw = event.detail && event.detail.draw;
    if (typeof draw === "function") draw(Overlayer.underline, { color: HIGHLIGHT_COLOR });
  });

  stage.append(view);

  try {
    // 先自己造 book，而不是把 File 直接丢给 open()：只有拿到 book 才能挂上
    // transformTarget 的那两个监听，而且必须赶在分节加载之前。
    const book = extension === "md" || extension === "markdown"
      ? await (await import("./markdown-book.js")).makeMarkdownBook(source, currentLabel)
      : await makeBook(source);
    if (token !== openToken) { book.destroy?.(); return false; }
    openedBook = book;
    const currentView = view;
    watchResources(book);
    await currentView.open(book);
    if (token !== openToken) { currentView.close(); return false; }
    // 页边距要在 init 之前给 —— init 会渲染第一页，等渲染完再改属性会白重排
    // 一次，位置也可能跟着动。
    if (view.renderer) {
      const attributes = Model.rendererAttributes(settings);
      for (const [name, value] of Object.entries(attributes)) {
        view.renderer.setAttribute(name, value);
      }
    }
    // open() 只装载、不导航；init() 才渲染第一页。少了这一步 renderer.pages
    // 会一直是 0 —— 屏幕上一片空白，而且不报任何错，最难查。
    const stored = currentId ? localStorage.getItem(Model.progressKey(currentId)) : null;
    const target = Model.restoreTarget(stored, canResolve(Model.parseProgress(stored).cfi));
    await currentView.init({ lastLocation: target });
    if (token !== openToken) return false;
  } catch (error) {
    if (token !== openToken) return false;
    view?.close();
    openedBook?.destroy?.();
    openedBook = null;
    stage.textContent = "";
    const failed = document.createElement("p");
    failed.className = "reader-error";
    failed.textContent = `打不开这本书：${error && error.message ? error.message : error}`;
    stage.append(failed);
    view = null;
    return false;
  }
  paintPosition(position);
  paintPanel();
  for (const control of el("reader-view").querySelectorAll(".reader-bar button")) control.disabled = false;
  return true;
}

// 从阅读模块页进来看书时走这里：先切页面，再装书。
export async function showReader(source, label, id) {
  View.setHeading(label || "阅读", "左右翻页。");
  // 第二参是面包屑最后一段用的 —— 读书页那段要显示书名，不是 view 名
  View.show("reader", label);
  return openBook(source, label, id);
}
