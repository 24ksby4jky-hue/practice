import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../src/home-model.js";

test("首页有 5 个模块，顺序固定", () => {
  assert.deepEqual(model.MODULES.map((m) => m.id),
    ["basic", "reading", "drill", "mock", "notebook"]);
  assert.deepEqual(model.MODULES.map((m) => m.name),
    ["基础练习", "阅读", "刷题", "模考", "生词本"]);
});

test("每个模块都有名字和一句说明，且不重复", () => {
  for (const item of model.MODULES) {
    assert.equal(typeof item.name, "string");
    assert.ok(item.name.length > 0);
    assert.equal(typeof item.note, "string");
    assert.ok(item.note.length > 0);
  }
  const names = new Set(model.MODULES.map((m) => m.name));
  assert.equal(names.size, model.MODULES.length);
  const notes = new Set(model.MODULES.map((m) => m.note));
  assert.equal(notes.size, model.MODULES.length);
});

test("做好的模块是 basic、reading、notebook，其余两个待开发", () => {
  assert.equal(model.isReady("basic"), true);
  assert.equal(model.isReady("reading"), true);
  assert.equal(model.isReady("notebook"), true);
  assert.equal(model.isReady("drill"), false);
  assert.equal(model.isReady("mock"), false);
  assert.equal(model.MODULES.filter((m) => m.status === "ready").length, 3);
});

test("moduleById 命中返回模块，不命中返回 null", () => {
  assert.equal(model.moduleById("reading").name, "阅读");
  assert.equal(model.moduleById("notebook").name, "生词本");
  assert.equal(model.moduleById("nope"), null);
  assert.equal(model.moduleById(undefined), null);
});

test("viewFor 决定点这个模块打开哪个页面", () => {
  assert.equal(model.viewFor("basic"), "basic");
  assert.equal(model.viewFor("notebook"), "notebook");
  assert.equal(model.viewFor("reading"), "reading");
  // 还没做的两个模块共用同一个占位页
  assert.equal(model.viewFor("drill"), "soon");
  assert.equal(model.viewFor("mock"), "soon");
  assert.equal(model.viewFor("nope"), null);
});

test("基础练习下面是打字练习和单词听写", () => {
  assert.deepEqual(model.PRACTICE.map((p) => p.id), ["typing", "dictation"]);
  assert.equal(model.practiceById("typing").name, "打字练习");
  assert.equal(model.practiceById("dictation").name, "单词听写");
  assert.equal(model.practiceById("nope"), null);
});

test("面包屑：打字和听写挂在基础练习下面，所以长一段", () => {
  assert.deepEqual(model.trailFor("typing"), [
    { name: "首页", view: "home" },
    { name: "基础练习", view: "basic" },
    { name: "打字练习", view: null }
  ]);
  assert.deepEqual(model.trailFor("dictation"), [
    { name: "首页", view: "home" },
    { name: "基础练习", view: "basic" },
    { name: "单词听写", view: null }
  ]);
});

test("面包屑：首页自己、基础练习、生词本", () => {
  assert.deepEqual(model.trailFor("home"), [{ name: "首页", view: null }]);
  assert.deepEqual(model.trailFor("basic"), [
    { name: "首页", view: "home" },
    { name: "基础练习", view: null }
  ]);
  assert.deepEqual(model.trailFor("notebook"), [
    { name: "首页", view: "home" },
    { name: "生词本", view: null }
  ]);
});

test("面包屑：占位页按是哪个模块取名", () => {
  assert.deepEqual(model.trailFor("soon", "drill"), [
    { name: "首页", view: "home" },
    { name: "刷题", view: null }
  ]);
  assert.deepEqual(model.trailFor("soon", "mock"), [
    { name: "首页", view: "home" },
    { name: "模考", view: null }
  ]);
  // 模块 id 对不上时不能崩，退成一个通用名字
  assert.deepEqual(model.trailFor("soon", "nope"), [
    { name: "首页", view: "home" },
    { name: "建设中", view: null }
  ]);
});

test("面包屑：阅读模块页，以及读书页要显示书名", () => {
  assert.deepEqual(model.trailFor("reading"), [
    { name: "首页", view: "home" },
    { name: "阅读", view: null }
  ]);
  // 读书页挂在阅读下面，最后一段是书名而不是 view 名
  assert.deepEqual(model.trailFor("reader", "Three Short Pieces"), [
    { name: "首页", view: "home" },
    { name: "阅读", view: "reading" },
    { name: "Three Short Pieces", view: null }
  ]);
  // 没给书名也得有东西显示
  assert.deepEqual(model.trailFor("reader"), [
    { name: "首页", view: "home" },
    { name: "阅读", view: "reading" },
    { name: "读书", view: null }
  ]);
});

test("面包屑最后一段永远是当前页，前面每一段都留着出口", () => {
  const paths = [
    model.trailFor("home"),
    model.trailFor("basic"),
    model.trailFor("notebook"),
    model.trailFor("typing"),
    model.trailFor("dictation"),
    model.trailFor("soon", "reading")
  ];
  for (const path of paths) {
    assert.equal(path[0].name, "首页");
    assert.equal(path[path.length - 1].view, null);
  }
  // 除了首页自己，每条路径的第一段都是可点的「首页」
  for (const path of paths.slice(1)) {
    assert.equal(path[0].view, "home");
  }
});
