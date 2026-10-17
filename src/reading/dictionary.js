import DOMPurify from "dompurify";
import { dictionaryShard, normalizeDictionaryKey, wordCandidates, wordBounds } from "./dictionary-model.js";

const base = `${import.meta.env.BASE_URL}dictionaries/collins/`;
let manifestPromise;
const cache = new Map();
export async function loadDictionaryManifest() {
  if (!manifestPromise) manifestPromise = fetch(`${base}manifest.json`).then(async (response) => {
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("词典数据尚未安装，请先运行词库导入命令，再重新构建项目。");
    const data = await response.json();
    if (data.version !== 1 || typeof data.count !== "number") throw new Error("词典索引格式不正确，请重新导入词库。");
    return data;
  }).catch((error) => { manifestPromise = null; throw error; });
  return manifestPromise;
}

async function shardFor(key, manifest) {
  const shard = dictionaryShard(key);
  if (!cache.has(shard)) {
    const request = fetch(`${base}${shard}.json?v=${encodeURIComponent(manifest.fingerprint)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取词典分片，请检查词库文件是否完整。路径：dictionaries/collins/");
        return response.json();
      }).catch((error) => { cache.delete(shard); throw error; });
    cache.set(shard, request);
    if (cache.size > 16) cache.delete(cache.keys().next().value);
  }
  return cache.get(shard);
}

export async function lookupWord(value) {
  const candidates = wordCandidates(value);
  if (!candidates.length) return null;
  const manifest = await loadDictionaryManifest();
  async function resolve(key, visited = new Set()) {
    if (!key || visited.has(key) || visited.size >= 8) return [];
    visited.add(key);
    const shard = await shardFor(key, manifest);
    const rows = Object.hasOwn(shard, key) ? shard[key] : [];
    const entries = [];
    for (const row of rows) {
      const link = row.html.trim().match(/^@@@LINK=(.+)/);
      if (link) entries.push(...await resolve(normalizeDictionaryKey(link[1].trim()), visited));
      else entries.push(row);
    }
    return entries;
  }
  for (const candidate of candidates) {
    const entries = await resolve(candidate);
    if (!entries.length) continue;
    // 柯林斯为部分变形词单设极短的说明词条，继续读取其注明的原形。
    if (entries.every((entry) => !entry.html.includes('C1_sentence_en'))) {
      const text = entries.map((entry) => new DOMParser().parseFromString(entry.html, "text/html").body.textContent).join(" ");
      const hint = text.match(/\b(?:plural|past tense|past participle|present participle|comparative|superlative)(?: form)? of\s+([a-z][a-z'’-]*)\b/i);
      const root = hint && normalizeDictionaryKey(hint[1]);
      if (root && root !== candidate) {
        const fullEntries = await resolve(root);
        if (fullEntries.length) return { query: candidates[0], matched: root, entries: fullEntries, title: manifest.title };
      }
    }
    return { query: candidates[0], matched: candidate, entries, title: manifest.title };
  }
  return { query: candidates[0], matched: null, entries: [], title: manifest.title };
}

// 字典本身也属于外部内容：不执行脚本、不使用其样式、不发起声音或图片请求。
export function dictionaryFragment(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const link of doc.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    if (href.startsWith("entry://")) link.setAttribute("data-entry", href);
    link.removeAttribute("href");
  }
  return DOMPurify.sanitize(doc.body.innerHTML, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "img", "audio", "video", "link", "form", "input", "button", "object", "embed"],
    FORBID_ATTR: ["style", "src", "srcset", "id"] });
}

export function dictionaryPreview(result) {
  const fragment = dictionaryFragment(result.entries.map((entry) => entry.html).join("\n"));
  const first = fragment.querySelector(".C1_explanation_box, .C1_explanation_item") || fragment;
  const copy = first.cloneNode(true);
  for (const extra of copy.querySelectorAll(".C1_item_number, .C1_explanation_label, .C1_word_header, .C1_color_bar, ul, .C1_sentence_en")) extra.remove();
  const text = copy.textContent.replace(/\s+/g, " ").trim();
  return { meaning: text.length > 240 ? `${text.slice(0, 240)}…` : text,
    example: fragment.querySelector(".C1_sentence_en")?.textContent.trim() || "" };
}

export function renderDictionaryEntries(target, result, { links = true } = {}) {
  target.replaceChildren();
  for (const entry of result.entries) {
    const article = document.createElement("article");
    article.className = "dictionary-entry";
    article.append(dictionaryFragment(entry.html));
    for (const link of article.querySelectorAll("a")) {
      link.removeAttribute("target");
      if (!links) link.removeAttribute("data-entry");
    }
    target.append(article);
  }
}

export function wordAtPoint(doc, event) {
  const selection = doc.getSelection?.();
  if (selection && !selection.isCollapsed) return null;
  let textNode, offset;
  if (typeof doc.caretPositionFromPoint === "function") {
    const point = doc.caretPositionFromPoint(event.clientX, event.clientY);
    textNode = point?.offsetNode; offset = point?.offset;
  } else if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(event.clientX, event.clientY);
    textNode = range?.startContainer; offset = range?.startOffset;
  }
  if (textNode?.nodeType !== 3) return null;
  const bounds = wordBounds(textNode.nodeValue, offset);
  if (!bounds) return null;
  const range = doc.createRange();
  range.setStart(textNode, bounds.start); range.setEnd(textNode, bounds.end);
  const inside = [...range.getClientRects()].some((rect) => event.clientX >= rect.left - 1 && event.clientX <= rect.right + 1
    && event.clientY >= rect.top - 1 && event.clientY <= rect.bottom + 1);
  return inside ? bounds.word : null;
}
