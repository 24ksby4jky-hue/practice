// 读书页（第一步只做到「能打开一本书并翻页」）。
//
// 引擎用 foliate-js（MIT，见 vendor/foliate/LICENSE），vendored 在
// ./vendor/foliate/。它是原生 ES 模块，import 进来就会注册 <foliate-view>
// 这个自定义元素，之后建元素、open()、next()/prev() 就行。
//
// 分页不是它自己算的排版：每个分节一个 iframe，里面用 CSS 多栏
// （column-width + column-gap）+ 定高容器 + translateX 翻页。
// 所以尺寸必须由外面给足 —— 容器高度是 0 的话它会一片空白。
import "./vendor/foliate/view.js";
import * as View from "../view.js";

let view = null;
let position = null;

const el = (id) => document.getElementById(id);

function layout() {
  const host = el("reader-view");
  host.textContent = "";

  const bar = document.createElement("div");
  bar.className = "reader-bar";

  const title = document.createElement("span");
  title.className = "reader-title";
  title.id = "reader-title";

  const pos = document.createElement("span");
  pos.className = "reader-pos";
  pos.id = "reader-pos";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.id = "reader-prev";
  prev.textContent = "上一页";

  const next = document.createElement("button");
  next.type = "button";
  next.id = "reader-next";
  next.textContent = "下一页";

  bar.append(title, pos, prev, next);

  const stage = document.createElement("div");
  stage.className = "reader-stage";
  stage.id = "reader-stage";

  host.append(bar, stage);

  prev.addEventListener("click", () => turn(-1));
  next.addEventListener("click", () => turn(1));
}

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
  if (!box) return;
  if (!loc) {
    box.textContent = "";
    return;
  }
  const label = loc.tocItem && loc.tocItem.label ? loc.tocItem.label : "";
  const total = loc.section ? loc.section.total : 0;
  const current = loc.section ? loc.section.current + 1 : 0;
  const percent = Math.round(bookFraction(loc) * 100);
  const where = total ? `${current}/${total}` : "";
  box.textContent = [label, where, `${percent}%`].filter(Boolean).join(" · ");
}

export function turn(delta) {
  if (!view) return;
  if (delta > 0) view.next();
  else view.prev();
}

export function isOpen() {
  return Boolean(view);
}

export function closeBook() {
  if (view) {
    try {
      view.close();
    } catch {
      // 关不干净不影响后面重开
    }
    view.remove();
    view = null;
  }
  position = null;
  const stage = el("reader-stage");
  if (stage) stage.textContent = "";
}

// source 可以是 File / Blob，也可以是可以 fetch 的 URL。
export async function openBook(source, label) {
  closeBook();
  layout();

  const stage = el("reader-stage");
  const title = el("reader-title");
  if (title) title.textContent = label || "";

  view = document.createElement("foliate-view");
  view.addEventListener("relocate", (event) => {
    position = event.detail || null;
    paintPosition(position);
  });
  // relocate 比首次渲染晚一拍，刚打开时读数会是空的 —— 分节载入时先亮一下，
  // 等 relocate 到了再补上章节名和真实进度。
  view.addEventListener("load", () => {
    if (!position) paintPosition({ fraction: 0, section: null, tocItem: null });
  });
  // 书里的链接不跳走，免得把整个应用替换掉
  view.addEventListener("external-link", (event) => event.preventDefault());

  stage.append(view);

  try {
    await view.open(source);
    // open() 只装载、不导航；init() 才渲染第一页。少了这一步 renderer.pages
    // 会一直是 0 —— 屏幕上一片空白，而且不报任何错，最难查。
    // lastLocation 是 B3 恢复进度要用的（init 会把它交给 resolveNavigation）。
    await view.init({ lastLocation: null });
  } catch (error) {
    stage.textContent = "";
    const failed = document.createElement("p");
    failed.className = "reader-error";
    failed.textContent = `打不开这本书：${error && error.message ? error.message : error}`;
    stage.append(failed);
    view = null;
    return false;
  }
  paintPosition(position);
  return true;
}

// 从阅读模块页进来看书时走这里：先切页面，再装书。
export async function showReader(source, label) {
  View.setHeading(label || "阅读", "左右翻页。");
  // 第二参是面包屑最后一段用的 —— 读书页那段要显示书名，不是 view 名
  View.show("reader", label);
  return openBook(source, label);
}
