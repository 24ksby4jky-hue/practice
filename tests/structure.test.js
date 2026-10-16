// 三处必须同步的地方，静默读文件来钉住 —— 不做 DOM 测试，和本仓库其余测试
// 一个路子（那些也只测纯模型）。
//
// 为什么只有这样一个「读源码」的测试：页面容器这层漏一处**不会报任何错**，
// 只是那个页面永远显示着、或者永远藏着。加一个视图要同时改三处：
//   view.js 的 VIEW_CONTAINERS  →  index.html 的容器  →  styles.css 的 [hidden] 规则
// 漏掉中间那个，点进去一片空白；漏掉最后那个，容器带的 display 规则会盖掉
// hidden 属性，于是它永远显示。两种都得靠肉眼盯，很难查。
//
// 同一个坑对任何「由 JS 切 hidden、自己又带 display」的元素都成立，所以下面
// 除了从 view.js 自动取的容器，还显式钉了一个（读书页里的浮层）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

function read(relative) {
  return readFileSync(new URL(relative, ROOT), "utf8");
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = new URL(entry + (statSync(new URL(entry + "/", dir)).isDirectory() ? "/" : ""), dir);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/* --------------------------------------------------------------------------
   视图容器：view.js → index.html → styles.css
   -------------------------------------------------------------------------- */

// 从 view.js 里把那张表抠出来 —— 它是「哪个页面在屏幕上」的唯一来源。
function viewContainers() {
  const source = read("src/view.js");
  const block = source.match(/const VIEW_CONTAINERS = \{([\s\S]*?)\};/);
  assert.ok(block, "view.js 里找不到 VIEW_CONTAINERS —— 是不是被改名了？");
  const table = {};
  for (const found of block[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) {
    table[found[1]] = found[2];
  }
  return table;
}

const containers = viewContainers();
const html = read("index.html");
const css = read("styles.css");

// 这些是「由 JS 切 hidden、自己又有 display 规则」的其它元素。
// 加一个就补一条，理由写在旁边。
const ALSO_TOGGLED = [
  // 读书页的目录/搜索/排版/朗读浮层：.reader-panel 有 display: block
  { id: "reader-panel", why: "读书页浮层，.reader-panel 带 display: block" }
];

test("view.js 里有视图容器表，而且不为空", () => {
  assert.ok(Object.keys(containers).length >= 8, `只读到 ${Object.keys(containers).length} 个容器`);
  assert.equal(containers.home, "home-view");
  assert.equal(containers.reader, "reader-view");
});

test("每个视图容器在 index.html 里都有对应的元素", () => {
  for (const [view, id] of Object.entries(containers)) {
    assert.ok(html.includes(`id="${id}"`),
      `index.html 里没有 id="${id}"（view.js 里 ${view} 指着它）—— 漏了它，这个页面点进去是空白的`);
  }
});

test("每个由 JS 切 hidden 的元素，styles.css 里都有 #<id>[hidden] 规则", () => {
  const ids = Object.values(containers).map((id) => ({ id, why: "视图容器" })).concat(ALSO_TOGGLED);
  for (const { id, why } of ids) {
    assert.ok(css.includes(`#${id}[hidden]`),
      `styles.css 里没有 #${id}[hidden]（${why}）—— 漏了它，容器自带的 display 会盖掉 hidden 属性，`
      + "于是它永远显示着，而且不报任何错");
  }
});

test("index.html 里的视图容器没有重复 id", () => {
  const seen = new Set();
  for (const id of Object.values(containers)) {
    assert.ok(!seen.has(id), `index.html 里 id="${id}" 重复了`);
    seen.add(id);
  }
});

/* --------------------------------------------------------------------------
   测试文件：磁盘上的和 test 脚本跑得到的对得上
   -------------------------------------------------------------------------- */

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

test("磁盘上每一个 .test.js 都在 test 脚本的覆盖范围内", () => {
  const script = JSON.parse(read("package.json")).scripts.test;
  const files = walk(new URL("tests/", ROOT))
    .map((url) => fileURLToPath(url))
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".test.js"))
    .map((path) => path.slice(path.indexOf("tests/")));

  assert.ok(files.length >= 10, `只找到 ${files.length} 个测试文件`);

  const args = script.replace(/^node\s+--test\s*/, "").trim();
  if (args === "") {
    // 裸 node --test：Node 自己发现。它认的模式就是 **/*.test.js 这一类，
    // 所以只要名字是 *.test.js 就一定跑得到。
    for (const file of files) {
      assert.ok(file.endsWith(".test.js"), `${file} 不会被 node --test 自动发现`);
    }
    return;
  }

  // 脚本里写了显式路径：那每个文件都得能被其中一个 glob 匹配上，
  // 否则新加一个子目录就会悄悄不跑
  const patterns = args.split(/\s+/).map(globToRegExp);
  for (const file of files) {
    assert.ok(patterns.some((re) => re.test(file)),
      `${file} 不被 test 脚本的任何一条路径覆盖（${args}）—— 它会静悄悄地不跑`);
  }
});

test("帮助文件不会被误当成测试跑起来", () => {
  // tests/dictation-words-support.js 是给别的测试 import 的，不是测试本身。
  // Node 发现测试的模式不认它，这里把这条也钉住。
  const script = JSON.parse(read("package.json")).scripts.test;
  assert.ok(!/dictation-words-support/.test(script),
    "test 脚本里点名了帮助文件 —— 它没有 test() 调用，跑起来只会报错");
});
