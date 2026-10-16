// 阅读模块的纯数据层：哪些文件算一本书、书名怎么取、一本书的身份是什么、
// 进度存哪儿、排版有哪些档位。全是函数，不碰 DOM、不碰 foliate、不碰
// File System Access —— 那些在 library.js（选文件夹）、reader.js（读书页）
// 和 reading.js（书架）里。

// 能打开的重排版式。foliate-js 其实还认识 PDF 和固定版式 EPUB，
// 但那两条路和 Readest 自己的构建绑死（见 vendor/README.md），这个版本不做，
// 所以那两个扩展名在这里就是「不算书」，选文件夹时直接被滤掉。
const BOOK_EXTENSIONS = ["epub", "mobi", "azw3", "fb2", "cbz"];

// 只认最后一段扩展名，而且要求它前面还有字符 ——
// "my.epub.notes.txt" 不是书（扩展名是 txt），隐藏文件 ".epub" 也不是。
function extensionOf(name) {
  if (typeof name !== "string") return "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

function isBookFile(name) {
  return BOOK_EXTENSIONS.indexOf(extensionOf(name)) !== -1;
}

// 书名暂时从文件名推：去掉扩展名，把下划线和连字符当分词换成空格。
// 这是零成本的近似 —— EPUB 内部的 dc:title 要解压才拿得到，
// 而且每本书都解一次会让书架出不来（理由同下一条 bookId）。
function titleFromFilename(name) {
  if (typeof name !== "string") return "";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const spaced = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced || name;
}

// 一本书的身份 = 文件夹名 + 文件名 + 字节数。
//
// 刻意不读整个文件算 hash：书架要立刻出来，不能等几十 MB 的书读完。
// 代价是精度 —— 同名同大小但换了文件夹会被当成另一本；反过来一本书重新下载、
// 字节数变了就会被当成新书（进度从零开始）。这个精度够用。
function bookId(folderName, name, size) {
  const folder = typeof folderName === "string" ? folderName : "";
  const file = typeof name === "string" ? name : "";
  const bytes = Number.isFinite(size) ? size : 0;
  return `${folder}/${file}@${bytes}`;
}

// 文件夹里的条目 → 书架。目录、不认识的格式、重复项都滤掉。
// entries 只需要 { name, size }（library.js 给的条目还带一个文件句柄，这里不看）。
function listBooks(folderName, entries) {
  const list = Array.isArray(entries) ? entries : [];
  const books = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry.name !== "string" || !isBookFile(entry.name)) continue;
    const size = Number.isFinite(entry.size) ? entry.size : 0;
    const id = bookId(folderName, entry.name, size);
    // 同一个文件不该出现两次 —— 身份一样就当同一本，留先出现的那个
    if (seen.has(id)) continue;
    seen.add(id);
    books.push({
      id,
      folder: typeof folderName === "string" ? folderName : "",
      name: entry.name,
      title: titleFromFilename(entry.name),
      size
    });
  }
  // numeric 让 "Book 2" 排在 "Book 10" 前面
  return books.sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true }));
}

/* --------------------------------------------------------------------------
   进度
   键的命名法和生词本的 "dictationNotebook:guest" 一致。
   -------------------------------------------------------------------------- */

const PROGRESS_PREFIX = "readingProgress";

function progressKey(id) {
  return `${PROGRESS_PREFIX}:${id}:guest`;
}

// 存的形状是 {"fraction":0.32,"cfi":"/6/4!/4/2/2:0"}：
//   fraction  整本书的比例，0–1。书架格子上显示的就是它。
//   cfi       书里的精确位置（foliate 的 CFI 字符串）。
// 早期版本只存了一个裸数字，这里还认它 —— 老记录不该因为改了格式就丢。
//
// 这个函数同时是**写**之前的归一化：落盘用现有的 writeJson（它自己会
// JSON.stringify），所以写进去的一定是 parseProgress 吐出来的那个形状。
function parseProgress(raw) {
  if (raw === null || raw === undefined || raw === "") return { fraction: 0, cfi: null };

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 不是 JSON —— 那就是老格式的裸数字，也可能是垃圾，下面一起判
      parsed = raw;
    }
  }

  if (typeof parsed === "number" || (typeof parsed === "string" && parsed.trim() !== "")) {
    const only = Number(parsed);
    if (Number.isFinite(only)) return { fraction: clampFraction(only), cfi: null };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { fraction: 0, cfi: null };
  }
  return {
    fraction: clampFraction(Number(parsed.fraction)),
    cfi: typeof parsed.cfi === "string" && parsed.cfi !== "" ? parsed.cfi : null
  };
}

// 翻到本节末尾时 relocate 的 fraction 会略微超过 1，封顶。
function clampFraction(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value);
}

// 书架格子上那一行。没读过就说「未读」，不显示 0% ——
// 0% 读起来像「读了但停在第 0 页」。
function progressLabel(raw) {
  const { fraction } = parseProgress(raw);
  if (fraction <= 0) return "未读";
  return `${Math.round(fraction * 100)}%`;
}

// 恢复位置该交给 view.init 什么。
//
// 优先 CFI —— 它记的是确切位置，不是「大概这一页」。但书换过版本之后
// CFI 可能解不出来，那时退回比例，别把用户扔回第一页。
function restoreTarget(raw, canResolveCfi) {
  const { fraction, cfi } = parseProgress(raw);
  if (cfi && canResolveCfi) return cfi;
  if (fraction > 0) return { fraction };
  return null;
}

/* --------------------------------------------------------------------------
   键盘
   判断放在这里是因为它们是纯的、能测；挂监听和取 DOM 属性在 reader.js 里。
   -------------------------------------------------------------------------- */

// 方向键往哪翻。其余按键一律不接 —— 阅读器不该抢走所有键。
function pageKey(key) {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return 0;
}

// 按下的地方是不是正在等用户打字。是的话方向键归它（比如搜索框里左右移动
// 光标），不该被拿去翻页。
function swallowsKeys(tagName, isEditable) {
  const name = typeof tagName === "string" ? tagName.toLowerCase() : "";
  if (name === "input" || name === "textarea" || name === "select") return true;
  return isEditable === true;
}

/* --------------------------------------------------------------------------
   搜索结果的摘要
   -------------------------------------------------------------------------- */

// foliate 的 makeExcerpt 给的是一段切好的摘要 { pre, match, post }，命中那截
// 单独拎出来，好让我们把它标重一点。别的匹配模式（nearby-words）可能直接给
// 字符串，所以这里统一成同一个形状 —— 渲染层就不用分情况了。
function parseExcerpt(excerpt) {
  if (typeof excerpt === "string") return { pre: "", match: excerpt, post: "" };
  if (!excerpt || typeof excerpt !== "object" || Array.isArray(excerpt)) {
    return { pre: "", match: "", post: "" };
  }
  const part = (value) => (typeof value === "string" ? value : "");
  return { pre: part(excerpt.pre), match: part(excerpt.match), post: part(excerpt.post) };
}

/* --------------------------------------------------------------------------
   目录
   拍平成一维，每项带层级 —— 渲染层照着 depth 缩进就行，不用自己递归。
   -------------------------------------------------------------------------- */

function tocEntries(toc, depth) {
  const list = Array.isArray(toc) ? toc : [];
  const level = Number.isFinite(depth) ? depth : 0;
  const out = [];
  for (const item of list) {
    if (!item || typeof item.href !== "string" || item.href === "") continue;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    out.push({ href: item.href, label: label || item.href, depth: level });
    out.push(...tocEntries(item.subitems, level + 1));
  }
  return out;
}

/* --------------------------------------------------------------------------
   朗读
   -------------------------------------------------------------------------- */

const SPEECH_KEY = "readingSpeech:guest";

// 语速档位。别承诺音色 —— 机器上装了什么语音就是什么，各家差得很远；
// 语速是可以承诺的，它只是喂给 SpeechSynthesisUtterance 的一个数。
const SPEECH_RATES = [0.7, 0.85, 1, 1.15, 1.3];

const DEFAULT_SPEECH = { rate: 1 };

function readSpeech(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    if (raw === "") parsed = null;
    else {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_SPEECH };
  }
  return { rate: pick(parsed.rate, SPEECH_RATES, DEFAULT_SPEECH.rate) };
}

/* --------------------------------------------------------------------------
   排版
   只做四项：字号、行高、页边距、纸色。每一项的档位都在这里定死 ——
   界面上的按钮直接读这些数组，不各自再写一遍数字。
   -------------------------------------------------------------------------- */

const TYPOGRAPHY_KEY = "readingTypography:guest";

const FONT_SIZES = [15, 17, 18, 20, 22, 24];
const LINE_HEIGHTS = [1.4, 1.6, 1.7, 1.9, 2.1];
const MARGINS = [24, 36, 48, 64, 88];

// 纸色。默认必须是「纸」—— 练习本的样子就是纸，暗色只是可选项，
// 不是这个应用的性格。
// scheme 一并给渲染器：它读 color-scheme 决定要不要按暗色处理，
// 页边距那圈留白的底色则来自 --theme-bg-color（见 typographyCss）。
const THEMES = {
  paper: { name: "纸", background: "#fdfdfd", color: "#14161c", scheme: "light" },
  sepia: { name: "米黄", background: "#f7f1e5", color: "#2a251d", scheme: "light" },
  night: { name: "夜间", background: "#16181d", color: "#c8cdd7", scheme: "dark" }
};

const DEFAULT_TYPOGRAPHY = { size: 18, lineHeight: 1.7, margin: 48, theme: "paper" };

// 传进来的是 localStorage 里的原始值。认不出来的一律退回默认 ——
// 设置坏掉的结果应该是「变回原样」，不是「书打不开」。
function readTypography(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    if (raw === "") parsed = null;
    else {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_TYPOGRAPHY };
  }
  const theme = typeof parsed.theme === "string" && THEMES[parsed.theme] ? parsed.theme : null;
  return {
    size: pick(parsed.size, FONT_SIZES, DEFAULT_TYPOGRAPHY.size),
    lineHeight: pick(parsed.lineHeight, LINE_HEIGHTS, DEFAULT_TYPOGRAPHY.lineHeight),
    margin: pick(parsed.margin, MARGINS, DEFAULT_TYPOGRAPHY.margin),
    theme: theme || DEFAULT_TYPOGRAPHY.theme
  };
}

// 档位是定死的，所以存进来的怪值直接退回默认档，
// 而不是硬塞一个界面上没有对应按钮的数字。
function pick(value, allowed, fallback) {
  return allowed.indexOf(value) === -1 ? fallback : value;
}

// 注入 iframe 的样式。
//
// 这几条正是用户用控件调出来的东西，必须压过书自己的 CSS —— 所有阅读器
// 都这么做，否则「字号」按钮在排过版的电子书上就是个摆设。其余一律不碰，
// 让书保持自己的排版。字号只设在根上，书里的相对字号照旧级联。
//
// --theme-bg-color / color-scheme 是给渲染器看的：页边距那圈留白是渲染器
// 自己画的（在 iframe 外面），它从书的 <html> 上读这两个值来决定填什么色。
// 不设的话换成夜间，正文黑了、四周一圈还是白的。
function typographyCss(raw) {
  const settings = readTypography(raw);
  const theme = THEMES[settings.theme];
  return [
    `html { font-size: ${settings.size}px !important; background: ${theme.background} !important;`
      + ` --theme-bg-color: ${theme.background}; color-scheme: ${theme.scheme}; }`,
    `body { line-height: ${settings.lineHeight} !important; color: ${theme.color} !important;`
      + ` background: ${theme.background} !important; }`
  ].join("\n");
}

// 页边距交给渲染器的属性：它在 iframe 外面排版，靠的是给内容留多少位置，
// 不是往书里塞 CSS。
function rendererAttributes(raw) {
  const settings = readTypography(raw);
  const px = `${settings.margin}px`;
  return {
    "margin-top": px,
    "margin-right": px,
    "margin-bottom": px,
    "margin-left": px
  };
}

const STYLE_ID = "reader-typography";

// 把样式塞进一份 XHTML 的 head 末尾 —— 排在书的样式后面，同等优先级下我们的赢。
//
// 找不到 head 就原样返回，由 reader.js 在 load 事件里直接用 DOM 插 ——
// 这里绝不硬塞到 <body> 前或文档最前面：XHTML 是 XML，塞错位置会让整节
// 解析失败，屏幕上是一片空白而且不报错。
function injectStyleTag(html, css) {
  if (typeof html !== "string") return html;
  const tag = `<style id="${STYLE_ID}">${css}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
  if (/<head[\s>]/i.test(html)) return html.replace(/<head[\s>]/i, (found) => `${found}${tag}`);
  return html;
}

export {
  BOOK_EXTENSIONS, extensionOf, isBookFile, titleFromFilename,
  bookId, listBooks,
  PROGRESS_PREFIX, progressKey, parseProgress, progressLabel, restoreTarget,
  tocEntries, parseExcerpt,
  pageKey, swallowsKeys,
  TYPOGRAPHY_KEY, DEFAULT_TYPOGRAPHY, FONT_SIZES, LINE_HEIGHTS, MARGINS, THEMES,
  readTypography, typographyCss, rendererAttributes,
  SPEECH_KEY, SPEECH_RATES, DEFAULT_SPEECH, readSpeech,
  STYLE_ID, injectStyleTag
};
