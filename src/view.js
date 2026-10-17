import * as HomeModel from "./home-model.js";
import {
  pauseTypingClock, resumeTypingClock, closeTypingOverlays, setNavigateAway
} from "./typing/app.js";

// 哪个页面在屏幕上 —— 全 app 只在这里决定。
// 这段原来是三份重复的（dictation.js 的 showDictation / showTyping 各一份，
// app.js 启动时还有一份），加了首页之后必须收成一处，否则每个新页面都要抄一遍。
const VIEW_CONTAINERS = {
  home: "home-view",
  basic: "basic-view",
  typing: "typing-view",
  dictation: "dictation-view",
  expansion: "expansion-view",
  notebook: "notebook-view",
  dictionary: "dictionary-view",
  reading: "reading-view",
  reader: "reader-view",
  soon: "soon-view"
};

// 右上角那排（字号 / 声音 / 退出）和「打字练习 / 单词听写」两个 tab，只有这两页
// 显示。这排东西是打字台的：字号由 typing/app.js 设在打字 stage 上，退出问的是
// 「本次打字还没结束」，声音管的是打字音效 —— 所以句子扩写页不显示它们（它有
// 自己的编辑区，草稿自动保存，不需要退出确认）。加新的练习项时对着这条判断。
const IN_BASIC = ["typing", "dictation"];

const handlers = {};
const leaveHandlers = {};

function el(id) {
  return document.getElementById(id);
}

function setHeading(title, subtitle) {
  const heading = document.querySelector(".topbar h1");
  const sub = document.querySelector(".topbar p");
  if (heading) heading.textContent = title;
  if (sub) sub.textContent = subtitle;
  document.title = title;
}

// 面包屑：祖先段可点，当前段是文字。
function renderTrail(view, moduleId) {
  const box = el("crumbs-path");
  if (!box) return;
  const trail = HomeModel.trailFor(view, moduleId);
  box.textContent = "";
  trail.forEach((step, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      box.append(sep);
    }
    if (step.view) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "crumb";
      link.textContent = step.name;
      link.addEventListener("click", () => open(step.view));
      box.append(link);
    } else {
      const here = document.createElement("span");
      here.className = "crumb-current";
      here.textContent = step.name;
      box.append(here);
    }
  });
}

// 只换页面：不动任何业务状态，所以从打字页走到首页再回来，
// 正文和已经输入的内容都在原处。
function show(view, moduleId) {
  const previous = document.body.dataset.view;
  if (previous !== view && typeof leaveHandlers[previous] === "function") leaveHandlers[previous]();
  document.body.dataset.view = view;

  for (const key of Object.keys(VIEW_CONTAINERS)) {
    const node = el(VIEW_CONTAINERS[key]);
    if (node) node.hidden = key !== view;
  }

  const inBasic = IN_BASIC.indexOf(view) !== -1;
  // 首页是根，不需要指路，整行收起
  const nav = el("subnav");
  if (nav) nav.hidden = view === "home";
  const tabs = el("view-switch");
  if (tabs) tabs.hidden = !inBasic;
  const actions = document.querySelector(".top-actions");
  if (actions) actions.hidden = !inBasic;
  // 「退出」只在打字页有意义 —— 听写本来就不留痕，别放个点不动的按钮在那儿
  const exit = el("exit-btn");
  if (exit) exit.hidden = view !== "typing";

  const typingTab = el("view-typing");
  const dictTab = el("view-dictation");
  if (typingTab) typingTab.classList.toggle("active", view === "typing");
  if (dictTab) dictTab.classList.toggle("active", view === "dictation");

  renderTrail(view, moduleId);
  closeTypingOverlays();

  // 限时挑战的时钟：不在打字页就必须停。isTypingView 只管「到点自动交卷」，
  // 时钟本身只有 pauseTypingClock 能停 —— 所以这里不做，用户在首页待着时间照跑。
  if (view === "typing") resumeTypingClock();
  else pauseTypingClock();
}

function register(view, enter, leave) {
  handlers[view] = enter;
  if (typeof leave === "function") leaveHandlers[view] = leave;
}

// 有专门入口就交给它（它自己负责画内容再调 show），没有就直接换页。
function open(view, moduleId) {
  const handler = handlers[view];
  if (typeof handler === "function") {
    handler(moduleId);
    return;
  }
  show(view, moduleId);
}

// app.js 里「退出」确认之后要知道该去哪个页面，把它交过去 —— 见 app.js 的
// setNavigateAway 注释：反过来 import 会成环。
setNavigateAway(open);

export { show, open, register, setHeading, VIEW_CONTAINERS };
