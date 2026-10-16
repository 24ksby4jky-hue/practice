import { marked } from "marked";
import DOMPurify from "dompurify";

const CSS = `
body { overflow-wrap: anywhere; }
pre { white-space: pre-wrap; padding: 1em; background: #8881; }
code { font-family: Consolas, monospace; }
table { border-collapse: collapse; max-width: 100%; }
td, th { border: 1px solid #8886; padding: .4em .7em; }
blockquote { margin-inline: 0; padding-inline-start: 1em; border-inline-start: 3px solid #8886; }
img { max-width: 100%; height: auto; }
.image-placeholder { color: #777; font-style: italic; }
`;

// 生成的文档和搜索用文档必须一致，CFI 才能在重开和搜索跳转时恢复。
export function markdownDocument(text, title) {
  const doc = document.implementation.createHTMLDocument(title);
  doc.body.innerHTML = DOMPurify.sanitize(marked.parse(text.replace(/^\uFEFF/, ""), {
    gfm: true, async: false
  }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "textarea", "button", "select"],
    FORBID_ATTR: ["style", "srcset"]
  });

  // 单文件导入没有相邻文件的读取权限；也不自动向外部站点请求图片。
  for (const image of [...doc.images]) {
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(image.getAttribute("src") || "")) continue;
    const placeholder = doc.createElement("span");
    placeholder.className = "image-placeholder";
    placeholder.textContent = `[图片：${image.alt || "外部或本地图片"}]`;
    image.replaceWith(placeholder);
  }
  const toc = [];
  const stack = [];
  const used = new Set();
  for (const heading of doc.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const base = heading.textContent.trim().toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s+/g, "-") || "heading";
    let id = base;
    for (let n = 1; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    heading.id = id;
    const level = Number(heading.tagName.slice(1));
    const entry = { label: heading.textContent.trim() || title, href: `markdown#${id}`, subitems: [] };
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    (stack.length ? stack.at(-1).entry.subitems : toc).push(entry);
    stack.push({ level, entry });
  }
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  doc.head.prepend(policy);
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.append(style);
  return { html: `<!doctype html>${doc.documentElement.outerHTML}`, toc };
}

export async function makeMarkdownBook(file, title) {
  const { html, toc } = markdownDocument(await file.text(), title);
  let url;
  const parse = () => new DOMParser().parseFromString(html, "text/html");
  return {
    metadata: { title },
    sections: [{
      id: "markdown", size: new TextEncoder().encode(html).length,
      load: () => (url ||= URL.createObjectURL(new Blob([html], { type: "text/html" }))),
      createDocument: parse
    }],
    toc,
    isExternal: (href) => !href.startsWith("#") && !href.startsWith("markdown#"),
    resolveHref(href) {
      if (href === "markdown") return { index: 0 };
      if (!href.startsWith("#") && !href.startsWith("markdown#")) return null;
      let id;
      try { id = decodeURIComponent(href.slice(href.indexOf("#") + 1)); }
      catch { return null; }
      return { index: 0, anchor: (doc) => doc.getElementById(id) };
    },
    splitTOCHref: (href) => href.split("#"),
    getTOCFragment: (doc, id) => doc.getElementById(id),
    destroy() { if (url) URL.revokeObjectURL(url); }
  };
}
