import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../src/reading/reading-model.js";

/* --------------------------------------------------------------------------
   哪些文件算一本书
   -------------------------------------------------------------------------- */

test("支持的书格式就是这五种，PDF 不在里面", () => {
  assert.deepEqual(model.BOOK_EXTENSIONS, ["epub", "mobi", "azw3", "fb2", "cbz"]);
  // PDF 和固定版式这一版不支持（见 vendor/README.md），所以它连「书」都不算，
  // 选文件夹时直接被滤掉，不会在书架上点开才发现打不开
  assert.equal(model.isBookFile("book.pdf"), false);
});

test("isBookFile 不区分大小写", () => {
  for (const name of ["a.epub", "a.EPUB", "a.Epub", "a.Mobi", "a.azw3", "a.FB2", "a.cbz"]) {
    assert.equal(model.isBookFile(name), true, name);
  }
});

test("isBookFile 拒绝别的格式、假扩展名和不是字符串的输入", () => {
  const rejected = [
    "notes.txt", "book.pdf", "book.zip", "book", "book.", ".epub",
    // 点不在最后一段 —— 它是个 txt
    "my.epub.notes.txt",
    // 名字里含 epub 但没有扩展名
    "bookepub",
    "", null, undefined, 42, {}
  ];
  for (const name of rejected) {
    assert.equal(model.isBookFile(name), false, String(name));
  }
});

test("extensionOf 只认最后一段扩展名", () => {
  assert.equal(model.extensionOf("Three Short Pieces.epub"), "epub");
  assert.equal(model.extensionOf("a.b.EPUB"), "epub");
  assert.equal(model.extensionOf("book."), "");
  assert.equal(model.extensionOf(".epub"), "");
  assert.equal(model.extensionOf("book"), "");
  assert.equal(model.extensionOf(null), "");
});

/* --------------------------------------------------------------------------
   书名
   -------------------------------------------------------------------------- */

test("书名从文件名取：去掉扩展名，下划线和连字符当分词", () => {
  assert.equal(model.titleFromFilename("Three Short Pieces.epub"), "Three Short Pieces");
  assert.equal(model.titleFromFilename("three_short_pieces.epub"), "three short pieces");
  assert.equal(model.titleFromFilename("three-short-pieces.epub"), "three short pieces");
  assert.equal(model.titleFromFilename("  spaced__out .epub"), "spaced out");
});

test("书名里不能把点当扩展名一起吃掉", () => {
  // 只有最后一段是扩展名，版本号要留着
  assert.equal(model.titleFromFilename("book.v2.epub"), "book.v2");
});

test("没有扩展名也不能返回空串 —— 书架上每一格必须有字", () => {
  assert.equal(model.titleFromFilename("README"), "README");
  assert.equal(model.titleFromFilename(null), "");
});

/* --------------------------------------------------------------------------
   一本书的身份
   -------------------------------------------------------------------------- */

test("书的身份 = 文件夹名 + 文件名 + 字节数", () => {
  assert.equal(model.bookId("books", "a.epub", 100), "books/a.epub@100");
});

test("改文件夹、改文件名、改大小都会变成另一本书", () => {
  const base = model.bookId("books", "a.epub", 100);
  assert.notEqual(model.bookId("other", "a.epub", 100), base);
  assert.notEqual(model.bookId("books", "b.epub", 100), base);
  assert.notEqual(model.bookId("books", "a.epub", 101), base);
  // 反过来，同一本书问两次必须一模一样 —— 否则存下去的进度就找不回来了
  assert.equal(model.bookId("books", "a.epub", 100), base);
});

test("身份里缺料也不能拼出 undefined", () => {
  assert.equal(model.bookId(undefined, "a.epub", 100), "/a.epub@100");
  assert.equal(model.bookId("books", "a.epub", undefined), "books/a.epub@0");
  assert.equal(model.bookId("books", "a.epub", NaN), "books/a.epub@0");
  // 不是数的 size 不当数用
  assert.equal(model.bookId("books", "a.epub", "100"), "books/a.epub@0");
});

/* --------------------------------------------------------------------------
   文件夹 → 书架
   -------------------------------------------------------------------------- */

test("listBooks 滤掉不是书的文件", () => {
  const books = model.listBooks("shelf", [
    { name: "apple.epub", size: 10 },
    { name: "notes.txt", size: 20 },
    { name: "manual.pdf", size: 30 },
    { name: "zebra.fb2", size: 40 }
  ]);
  assert.deepEqual(books.map((b) => b.name), ["apple.epub", "zebra.fb2"]);
});

test("每本书都带齐书架要显示的东西", () => {
  const [book] = model.listBooks("shelf", [{ name: "three_short_pieces.epub", size: 7 }]);
  assert.equal(book.title, "three short pieces");
  assert.equal(book.name, "three_short_pieces.epub");
  assert.equal(book.id, "shelf/three_short_pieces.epub@7");
  assert.equal(book.folder, "shelf");
  assert.equal(book.size, 7);
});

test("排序认得数字，Book 2 排在 Book 10 前面", () => {
  const books = model.listBooks("s", [
    { name: "Book 10.epub", size: 1 },
    { name: "Book 2.epub", size: 1 }
  ]);
  assert.deepEqual(books.map((b) => b.title), ["Book 2", "Book 10"]);
});

test("同一个文件出现两次只算一本", () => {
  const books = model.listBooks("s", [
    { name: "a.epub", size: 5 },
    { name: "a.epub", size: 5 }
  ]);
  assert.equal(books.length, 1);
});

test("同名但大小不同是两本 —— 身份里的大小在起作用", () => {
  const books = model.listBooks("s", [
    { name: "a.epub", size: 5 },
    { name: "a.epub", size: 6 }
  ]);
  assert.equal(books.length, 2);
  assert.notEqual(books[0].id, books[1].id);
});

test("目录条目、坏数据、空输入都不能让它崩", () => {
  assert.deepEqual(model.listBooks("s", null), []);
  assert.deepEqual(model.listBooks("s", []), []);
  assert.deepEqual(model.listBooks("s", [null, undefined, {}, { name: 42 }]), []);
});

test("没有 size 的条目照样收，大小按 0 算", () => {
  const books = model.listBooks("s", [{ name: "a.epub" }]);
  assert.equal(books.length, 1);
  assert.equal(books[0].size, 0);
  assert.equal(books[0].id, "s/a.epub@0");
});

test("文件夹名缺失时身份还拼得出来，只是没有前缀", () => {
  assert.deepEqual(model.listBooks(undefined, [{ name: "a.epub", size: 1 }]), [
    { id: "/a.epub@1", folder: "", name: "a.epub", title: "a", size: 1 }
  ]);
});

/* --------------------------------------------------------------------------
   进度
   -------------------------------------------------------------------------- */

test("进度键和生词本同一个命名法（…:guest）", () => {
  assert.equal(model.PROGRESS_PREFIX, "readingProgress");
  assert.equal(model.progressKey("books/a.epub@100"), "readingProgress:books/a.epub@100:guest");
  // 指纹里有 / 和 @，localStorage 的键名允许，不用转义
  assert.ok(model.progressKey("books/a.epub@100").indexOf("/") > 0);
});

test("parseProgress 读新格式：比例加 CFI", () => {
  const raw = JSON.stringify({ fraction: 0.32, cfi: "/6/4!/4/2/2:0" });
  assert.deepEqual(model.parseProgress(raw), { fraction: 0.32, cfi: "/6/4!/4/2/2:0" });
});

test("parseProgress 还认老格式的裸数字 —— 老记录不该因为改了格式就丢", () => {
  assert.deepEqual(model.parseProgress("0.32"), { fraction: 0.32, cfi: null });
  assert.deepEqual(model.parseProgress(0.32), { fraction: 0.32, cfi: null });
});

test("parseProgress 是写之前的归一化：吐出来的形状就是落盘的形状", () => {
  // 落盘走的是 writeJson，它自己 JSON.stringify，所以存进去的一定是这个对象
  const normalized = model.parseProgress({ fraction: 1.4, cfi: "" });
  assert.deepEqual(normalized, { fraction: 1, cfi: null });
  assert.deepEqual(model.parseProgress(JSON.stringify(normalized)), normalized);
});

test("读进度：读不出来就当没读过", () => {
  assert.deepEqual(model.parseProgress(null), { fraction: 0, cfi: null });
  assert.deepEqual(model.parseProgress(undefined), { fraction: 0, cfi: null });
  assert.deepEqual(model.parseProgress(""), { fraction: 0, cfi: null });
  assert.deepEqual(model.parseProgress("0"), { fraction: 0, cfi: null });
  assert.deepEqual(model.parseProgress("abc"), { fraction: 0, cfi: null });
  assert.deepEqual(model.parseProgress("[]"), { fraction: 0, cfi: null });
  assert.deepEqual(model.parseProgress("-1"), { fraction: 0, cfi: null });
  assert.deepEqual(model.parseProgress("{}"), { fraction: 0, cfi: null });
});

test("进度封顶在 1 —— 翻到本节末尾时 relocate 的 fraction 会略微超过 1", () => {
  assert.equal(model.parseProgress("1.4").fraction, 1);
  assert.equal(model.parseProgress(2).fraction, 1);
  assert.equal(model.parseProgress(1).fraction, 1);
  assert.equal(model.parseProgress("0.32").fraction, 0.32);
});

test("CFI 不是字符串就当没有，别把垃圾喂给引擎", () => {
  assert.equal(model.parseProgress(JSON.stringify({ fraction: 0.5, cfi: 42 })).cfi, null);
  assert.equal(model.parseProgress(JSON.stringify({ fraction: 0.5, cfi: "" })).cfi, null);
  assert.equal(model.parseProgress(JSON.stringify({ fraction: 0.5 })).cfi, null);
});

test("没读过显示「未读」，不显示 0%", () => {
  // 0% 读起来像「读了但停在第 0 页」，和真的没读过是两回事
  assert.equal(model.progressLabel(null), "未读");
  assert.equal(model.progressLabel("0"), "未读");
  assert.equal(model.progressLabel("abc"), "未读");
  assert.equal(model.progressLabel(JSON.stringify({ fraction: 0, cfi: null })), "未读");
});

test("进度取整成百分比", () => {
  assert.equal(model.progressLabel("0.32"), "32%");
  assert.equal(model.progressLabel("0.005"), "1%");
  assert.equal(model.progressLabel("1"), "100%");
  assert.equal(model.progressLabel(JSON.stringify({ fraction: 0.32, cfi: "/6/4" })), "32%");
  // 开了个头但还不到半分：仍是「读过」，只是取整后落在 0%
  assert.equal(model.progressLabel("0.001"), "0%");
});

test("恢复位置优先用 CFI —— 它记的是确切位置，不是大概这一页", () => {
  const raw = JSON.stringify({ fraction: 0.32, cfi: "/6/4!/4/2/2:0" });
  assert.equal(model.restoreTarget(raw, true), "/6/4!/4/2/2:0");
});

test("CFI 解不出来就退回比例，别把用户扔回第一页", () => {
  const raw = JSON.stringify({ fraction: 0.32, cfi: "/6/4!/4/2/2:0" });
  assert.deepEqual(model.restoreTarget(raw, false), { fraction: 0.32 });
  // 只有 CFI、没有比例，又解不出来 —— 那就只能从头开始
  assert.equal(model.restoreTarget(JSON.stringify({ fraction: 0, cfi: "/6/4" }), false), null);
});

test("没读过就不恢复 —— init 拿到 null 会自己翻到第一页", () => {
  assert.equal(model.restoreTarget(null, true), null);
  assert.equal(model.restoreTarget("0", true), null);
});

/* --------------------------------------------------------------------------
   目录
   -------------------------------------------------------------------------- */

test("目录拍平成一维，每项带层级", () => {
  const toc = [
    { label: "第一章", href: "ch1.xhtml", subitems: [
      { label: "第一节", href: "ch1.xhtml#s1" }
    ] },
    { label: "第二章", href: "ch2.xhtml" }
  ];
  assert.deepEqual(model.tocEntries(toc), [
    { href: "ch1.xhtml", label: "第一章", depth: 0 },
    { href: "ch1.xhtml#s1", label: "第一节", depth: 1 },
    { href: "ch2.xhtml", label: "第二章", depth: 0 }
  ]);
});

test("没有 label 的目录项用 href 顶上 —— 列表里不能有看不见的一行", () => {
  const entries = model.tocEntries([{ href: "ch1.xhtml" }, { label: "   ", href: "ch2.xhtml" }]);
  assert.deepEqual(entries.map((e) => e.label), ["ch1.xhtml", "ch2.xhtml"]);
});

test("没有 href 的目录项直接丢掉 —— 点了不动的按钮不如没有", () => {
  assert.deepEqual(model.tocEntries([{ label: "空" }, { label: "好", href: "a.xhtml" }]), [
    { href: "a.xhtml", label: "好", depth: 0 }
  ]);
});

/* --------------------------------------------------------------------------
   键盘
   -------------------------------------------------------------------------- */

test("只有左右方向键翻页，其余一律不接", () => {
  assert.equal(model.pageKey("ArrowLeft"), -1);
  assert.equal(model.pageKey("ArrowRight"), 1);
  // 阅读器不该抢走所有键
  assert.equal(model.pageKey("ArrowUp"), 0);
  assert.equal(model.pageKey("ArrowDown"), 0);
  assert.equal(model.pageKey("a"), 0);
  assert.equal(model.pageKey(" "), 0);
  assert.equal(model.pageKey("Enter"), 0);
  assert.equal(model.pageKey(undefined), 0);
});

test("在等着打字的地方，方向键归它 —— 搜索框里左右键是移光标", () => {
  assert.equal(model.swallowsKeys("INPUT", true), true);
  assert.equal(model.swallowsKeys("input", false), true);
  assert.equal(model.swallowsKeys("TEXTAREA", false), true);
  assert.equal(model.swallowsKeys("SELECT", false), true);
  // contenteditable 的元素 tagName 是什么都有可能
  assert.equal(model.swallowsKeys("DIV", true), true);
});

test("普通元素不吞方向键", () => {
  assert.equal(model.swallowsKeys("BUTTON", false), false);
  assert.equal(model.swallowsKeys("BODY", false), false);
  assert.equal(model.swallowsKeys("DIV", false), false);
  // 坏数据不能让它反过来把方向键吞掉
  assert.equal(model.swallowsKeys(null, undefined), false);
  assert.equal(model.swallowsKeys(undefined, null), false);
});

/* --------------------------------------------------------------------------
   朗读
   -------------------------------------------------------------------------- */

test("语速默认 1 倍，档位里必须有它 —— 否则一进朗读就没有按钮是选中的", () => {
  assert.deepEqual(model.readSpeech(null), { rate: 1 });
  assert.ok(model.SPEECH_RATES.indexOf(model.DEFAULT_SPEECH.rate) !== -1);
  assert.equal(model.SPEECH_KEY, "readingSpeech:guest");
});

test("语速读得回来，坏值退回默认", () => {
  assert.deepEqual(model.readSpeech(JSON.stringify({ rate: 1.3 })), { rate: 1.3 });
  assert.deepEqual(model.readSpeech("不是 JSON"), { rate: 1 });
  assert.deepEqual(model.readSpeech("[]"), { rate: 1 });
  // 界面上没有的档位一律退回默认，不留一个选中不了的值
  assert.deepEqual(model.readSpeech(JSON.stringify({ rate: 5 })), { rate: 1 });
});

/* --------------------------------------------------------------------------
   搜索摘要
   -------------------------------------------------------------------------- */

test("摘要切成 pre / match / post 三段", () => {
  assert.deepEqual(
    model.parseExcerpt({ pre: "…along the ", match: "river", post: " bank…" }),
    { pre: "…along the ", match: "river", post: " bank…" });
});

test("摘要直接给字符串时整段算命中", () => {
  assert.deepEqual(model.parseExcerpt("river"), { pre: "", match: "river", post: "" });
});

test("摘要缺字段或坏数据都不能拼出 undefined", () => {
  assert.deepEqual(model.parseExcerpt(null), { pre: "", match: "", post: "" });
  assert.deepEqual(model.parseExcerpt(undefined), { pre: "", match: "", post: "" });
  assert.deepEqual(model.parseExcerpt(42), { pre: "", match: "", post: "" });
  assert.deepEqual(model.parseExcerpt([]), { pre: "", match: "", post: "" });
  assert.deepEqual(model.parseExcerpt({ match: "river" }), { pre: "", match: "river", post: "" });
  assert.deepEqual(model.parseExcerpt({ pre: 1, match: "x", post: null }),
    { pre: "", match: "x", post: "" });
});

test("目录是坏数据也不能崩", () => {
  assert.deepEqual(model.tocEntries(null), []);
  assert.deepEqual(model.tocEntries([]), []);
  assert.deepEqual(model.tocEntries([null, undefined, 42, {}, { href: 1 }]), []);
});

/* --------------------------------------------------------------------------
   排版
   -------------------------------------------------------------------------- */

test("默认排版是纸、18px、1.7、48 —— 练习本的样子", () => {
  assert.deepEqual(model.readTypography(null), { size: 18, lineHeight: 1.7, margin: 48, theme: "paper" });
  assert.equal(model.DEFAULT_TYPOGRAPHY.theme, "paper");
  // 暗色是选项，不是默认
  assert.ok(model.THEMES.night);
  assert.equal(Object.keys(model.THEMES)[0], "paper");
});

test("排版读得回来", () => {
  const raw = JSON.stringify({ size: 22, lineHeight: 1.9, margin: 64, theme: "sepia" });
  assert.deepEqual(model.readTypography(raw), { size: 22, lineHeight: 1.9, margin: 64, theme: "sepia" });
});

test("排版坏掉就退回默认，不能连累书打不开", () => {
  const fallback = model.DEFAULT_TYPOGRAPHY;
  assert.deepEqual(model.readTypography("不是 JSON"), fallback);
  assert.deepEqual(model.readTypography(""), fallback);
  assert.deepEqual(model.readTypography("[]"), fallback);
  // 档位是定死的：界面里没有的档位一律退回默认，不留一个选中不了的值
  assert.equal(model.readTypography(JSON.stringify({ size: 999 })).size, fallback.size);
  assert.equal(model.readTypography(JSON.stringify({ theme: "neon" })).theme, "paper");
  assert.equal(model.readTypography(JSON.stringify({ lineHeight: "大" })).lineHeight, fallback.lineHeight);
});

test("每一项的档位里都有默认值 —— 否则界面一进去就没有按钮是选中的", () => {
  const d = model.DEFAULT_TYPOGRAPHY;
  assert.ok(model.FONT_SIZES.indexOf(d.size) !== -1);
  assert.ok(model.LINE_HEIGHTS.indexOf(d.lineHeight) !== -1);
  assert.ok(model.MARGINS.indexOf(d.margin) !== -1);
  assert.ok(model.THEMES[d.theme]);
});

test("注入的样式只管用户调的那几样，其余不碰", () => {
  const css = model.typographyCss({ size: 20, lineHeight: 1.9, margin: 64, theme: "paper" });
  assert.ok(css.indexOf("font-size: 20px !important") !== -1);
  assert.ok(css.indexOf("line-height: 1.9 !important") !== -1);
  // 页边距不在 CSS 里 —— 它是渲染器的属性，在 iframe 外面排版
  assert.equal(css.indexOf("margin"), -1);
});

test("纸色同时告诉渲染器那圈留白填什么 —— 否则换夜间四周还是白的", () => {
  const night = model.typographyCss({ theme: "night" });
  assert.ok(night.indexOf("--theme-bg-color: #16181d") !== -1);
  assert.ok(night.indexOf("color-scheme: dark") !== -1);
  assert.ok(night.indexOf("color: #c8cdd7 !important") !== -1);
  const paper = model.typographyCss({ theme: "paper" });
  assert.ok(paper.indexOf("color-scheme: light") !== -1);
});

test("页边距映射成渲染器的四个属性", () => {
  assert.deepEqual(model.rendererAttributes({ margin: 64 }), {
    "margin-top": "64px",
    "margin-right": "64px",
    "margin-bottom": "64px",
    "margin-left": "64px"
  });
});

test("样式插在 head 末尾 —— 排在书的样式后面，同等优先级下我们的赢", () => {
  const html = "<html><head><link rel='stylesheet' href='a.css'></head><body>x</body></html>";
  const out = model.injectStyleTag(html, "html{font-size:20px}");
  assert.ok(out.indexOf(`<style id="${model.STYLE_ID}">html{font-size:20px}</style></head>`) !== -1);
  // 一定要在书自己的样式之后
  assert.ok(out.indexOf("a.css") < out.indexOf(model.STYLE_ID));
});

test("大小写不一的 head 也认", () => {
  const out = model.injectStyleTag("<HTML><HEAD></HEAD><BODY>x</BODY></HTML>", "a{}");
  assert.ok(out.indexOf(model.STYLE_ID) !== -1);
});

test("没有 head 就原样返回，交给 load 事件用 DOM 补", () => {
  // 绝不硬塞到 <body> 前或文档最前面：XHTML 是 XML，塞错位置整节解析失败，
  // 屏幕上一片空白而且不报错
  const html = "<html><body>x</body></html>";
  assert.equal(model.injectStyleTag(html, "a{}"), html);
  assert.equal(model.injectStyleTag(null, "a{}"), null);
  assert.equal(model.injectStyleTag(42, "a{}"), 42);
});

test("有 head 开标签但没闭合标签时，插在 head 开标签后面", () => {
  const out = model.injectStyleTag("<html><head><title>t</title></head >", "a{}");
  assert.ok(out.indexOf(model.STYLE_ID) !== -1);
});
