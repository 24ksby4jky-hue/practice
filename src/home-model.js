// 首页的模块清单。这是模块名字的唯一来源 —— 首页格子、基础练习格子、
// 建设中占位页、面包屑都读这里，不在别处再写一遍。
//
//   status: "ready" 已经能用   "soon" 还没做，点进去是占位页
//   view:   点它打开哪个页面。"soon" 是三个未开发模块共用的一页。
const MODULES = [
  { id: "basic", name: "基础练习", note: "打字练习 · 单词听写", status: "ready", view: "basic" },
  { id: "reading", name: "阅读", note: "读自己的书，或内置样本", status: "ready", view: "reading" },
  { id: "drill", name: "刷题", note: "按题型反复练", status: "soon", view: "soon" },
  { id: "mock", name: "模考", note: "整卷限时模拟", status: "soon", view: "soon" },
  { id: "notebook", name: "生词本", note: "听写里记下的词", status: "ready", view: "notebook" }
];

// 基础练习下面的两项。打字练习和单词听写原本是平级 tab，现在收进这里。
const PRACTICE = [
  { id: "typing", name: "打字练习", note: "按原文逐字输入" },
  { id: "dictation", name: "单词听写", note: "8 个板块 · 4000 词" }
];

const ROOT = { name: "首页", view: "home" };

function moduleById(id) {
  return MODULES.find((item) => item.id === id) || null;
}

function practiceById(id) {
  return PRACTICE.find((item) => item.id === id) || null;
}

function isReady(id) {
  const found = moduleById(id);
  return Boolean(found) && found.status === "ready";
}

function viewFor(id) {
  const found = moduleById(id);
  return found ? found.view : null;
}

// 面包屑。祖先段带 view（可点），当前段 view 为 null（是文字，不是按钮）。
// extra：占位页传模块 id，读书页传书名。
function trailFor(view, extra) {
  if (view === "home") return [{ name: ROOT.name, view: null }];
  // 模块页：首页 › 模块名
  if (view === "basic" || view === "notebook" || view === "reading") {
    const found = moduleById(view);
    return [ROOT, { name: found ? found.name : view, view: null }];
  }
  // 读书页挂在阅读下面：首页 › 阅读 › 书名
  if (view === "reader") {
    return [ROOT, { name: moduleById("reading").name, view: "reading" },
      { name: extra || "读书", view: null }];
  }
  if (view === "soon") {
    const found = moduleById(extra);
    return [ROOT, { name: found ? found.name : "建设中", view: null }];
  }
  // 打字练习和单词听写挂在基础练习下面，所以路径比别的页面长一段。
  const leaf = practiceById(view);
  return [ROOT, { name: moduleById("basic").name, view: "basic" },
    { name: leaf ? leaf.name : view, view: null }];
}

export { MODULES, PRACTICE, moduleById, practiceById, isReady, viewFor, trailFor };
