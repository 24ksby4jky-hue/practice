import { exerciseById } from "./exercises.js";
import { METHOD_IDS } from "./methods.js";

export const STORAGE_KEY = "sentenceExpansion:guest";
export const MAX_ANSWER = 1200;
// 融合出来的段落是一整段，不是一句，所以上限单独放宽。
export const MAX_FUSION = 6000;
// 论证块数量没有天然上限，但每次落盘都要把整份记录重新序列化一遍，
// 块越多「打字时那一下」越慢 —— 和 RECORD_LIMIT 是同一个理由。
export const MAX_ARGUMENTS = 12;
export const STORE_VERSION = 2;
export const DEFAULT_CONFIG = Object.freeze({ baseUrl: "https://api.deepseek.com", model: "deepseek-flash" });

export function normalizeConfig(config = {}) {
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "").trim();
  if (!apiKey || /[\s\r\n]/.test(apiKey)) throw new Error("请填写有效的 API Key，不要包含空格或换行。");
  if (!model || model.length > 150 || /\s/.test(model)) throw new Error("请填写有效的模型名称。");
  let url;
  try { url = new URL(String(config.baseUrl || "").trim()); }
  catch { throw new Error("API 地址无效，请填写完整的 https:// 地址。"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new Error("API 地址须使用 HTTPS，且不能包含账号、密码或查询参数。本机地址可用 HTTP。");
  }
  const baseUrl = url.href.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  return { apiKey, model, baseUrl, endpoint: `${baseUrl}/chat/completions` };
}

export function answerError(value) {
  if (typeof value !== "string" || !value.trim()) return "先写一句英文，再继续。";
  if (value.length > MAX_ANSWER) return `句子最多 ${MAX_ANSWER} 个字符。`;
  if (!/[a-z]/i.test(value)) return "请用英文写出你的句子。";
  return null;
}

export function parseOptimized(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.optimized !== "string" || answerError(value.optimized)
    || value.optimized.length > MAX_ANSWER) {
    throw new Error("AI 返回的优化结果格式不完整，请手动重试。你的原稿已保留。");
  }
  return value.optimized.trim();
}

export function parseParagraph(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.paragraph !== "string" || !value.paragraph.trim()
    || !/[a-z]/i.test(value.paragraph) || value.paragraph.length > MAX_FUSION) {
    throw new Error("AI 返回的段落格式不完整，请手动重试。你的内容已保留。");
  }
  return value.paragraph.trim();
}

// 论点改写和论证块形状相同，只是一处唯一、一处可以有多个。
// 把「文本变了就把对应的勾撤掉」这条规则收在这里，两处不会各写一遍。
function emptyBlock(fields) {
  return { text: "", optimized: "", checkedText: false, checkedOptimized: false, usedAi: false, ...fields };
}

function withText(block, value) {
  const text = typeof value === "string" ? value.slice(0, MAX_ANSWER) : "";
  // 框被清空时，原来那个「用我写的这句」的勾必须跟着失效 —— 空的块不能被送进模型。
  return { ...block, text, checkedText: block.checkedText && Boolean(text.trim()) };
}

function withOptimized(block, value) {
  // 覆盖上一次结果，但保留勾选：学生勾的是「AI 优化版」这一版，
  // 重新优化只是换了个更好的说法，想用它的意图没变。
  return { ...block, optimized: String(value || "").slice(0, MAX_ANSWER), usedAi: true };
}

// 返回 null 表示这个勾不该被改动（目标槽是空的）。
function toggled(block, which) {
  const key = which === "optimized" ? "checkedOptimized" : "checkedText";
  const slot = which === "optimized" ? block.optimized : block.text;
  if (!String(slot || "").trim()) return null;
  return { ...block, [key]: !block[key] };
}

export function newSession(exerciseId, id, at) {
  if (!exerciseById(exerciseId)) throw new Error("找不到这道练习题。");
  return { id, exerciseId, claimEdit: emptyBlock(), arguments: [], fusion: "",
    completed: false, startedAt: at, updatedAt: at };
}

export function addArgument(session, method, id, at) {
  if (!METHOD_IDS.has(method)) throw new Error("未知的论证方法。");
  if (session.arguments.length >= MAX_ARGUMENTS) throw new Error(`最多添加 ${MAX_ARGUMENTS} 个论证块。`);
  if (session.arguments.some((item) => item.id === id)) throw new Error("论证块编号重复。");
  return { ...session, updatedAt: at, arguments: [...session.arguments, emptyBlock({ id, method })] };
}

export function removeArgument(session, id, at) {
  if (!session.arguments.some((item) => item.id === id)) return session;
  return { ...session, updatedAt: at, arguments: session.arguments.filter((item) => item.id !== id) };
}

export function setClaimText(session, text, at) {
  return { ...session, updatedAt: at, claimEdit: withText(session.claimEdit, text) };
}

export function setArgumentText(session, id, text, at) {
  return { ...session, updatedAt: at,
    arguments: session.arguments.map((item) => (item.id === id ? withText(item, text) : item)) };
}

export function setClaimOptimized(session, optimized, at) {
  return { ...session, updatedAt: at, claimEdit: withOptimized(session.claimEdit, optimized) };
}

export function setArgumentOptimized(session, id, optimized, at) {
  return { ...session, updatedAt: at,
    arguments: session.arguments.map((item) => (item.id === id ? withOptimized(item, optimized) : item)) };
}

export function toggleClaimCheck(session, which, at) {
  const next = toggled(session.claimEdit, which);
  return next ? { ...session, updatedAt: at, claimEdit: next } : session;
}

export function toggleArgumentCheck(session, id, which, at) {
  const block = session.arguments.find((item) => item.id === id);
  const next = block ? toggled(block, which) : null;
  if (!next) return session;
  return { ...session, updatedAt: at,
    arguments: session.arguments.map((item) => (item.id === id ? next : item)) };
}

// 一块论证只要有一版被勾中就算数 —— 同一块勾了原句又勾了优化版，仍然只是一块。
function blockPicked(block) {
  return Boolean((block.checkedText && block.text.trim()) || (block.checkedOptimized && block.optimized.trim()));
}

// 「融合成段」能不能按：至少一版丰富后的论点，外加至少两块不同的论证。
// 返回 reason 而不是裸布尔，按钮提示和测试就共用同一份中文说明。
export function fusionStatus(session) {
  const picked = session.arguments.filter(blockPicked).length;
  if (!blockPicked(session.claimEdit)) {
    return { ok: false, count: picked, reason: "先勾选一版丰富后的论点（原句或优化版）。" };
  }
  if (picked < 2) return { ok: false, count: picked, reason: `还需要勾选 ${2 - picked} 个不同的论证块。` };
  return { ok: true, count: picked, reason: "" };
}

// 送进模型的顺序：先勾中的论点，再按学生添加论证块的顺序送勾中的论证；
// 同一块两版都勾时，先原句、后优化版。点按钮时一次性快照成普通对象，
// 免得在途请求被后续编辑影响。
export function fusionPayload(session) {
  const parts = [];
  const claim = session.claimEdit;
  if (claim.checkedText && claim.text.trim()) parts.push({ role: "claim", source: "text", text: claim.text.trim() });
  if (claim.checkedOptimized && claim.optimized.trim()) {
    parts.push({ role: "claim", source: "optimized", text: claim.optimized.trim() });
  }
  for (const block of session.arguments) {
    if (block.checkedText && block.text.trim()) {
      parts.push({ role: "argument", method: block.method, source: "text", text: block.text.trim() });
    }
    if (block.checkedOptimized && block.optimized.trim()) {
      parts.push({ role: "argument", method: block.method, source: "optimized", text: block.optimized.trim() });
    }
  }
  return parts;
}

export function fuseSession(session, paragraph, at) {
  const fusion = typeof paragraph === "string" ? paragraph.trim().slice(0, MAX_FUSION) : "";
  if (!fusion) throw new Error("融合结果为空，请手动重试。你的内容已保留。");
  return { ...session, fusion, completed: true, updatedAt: at };
}

// ---- 落盘净化：只允许练习字段。AI 配置和 Key 不属于这个存储结构。----

function cleanClaimEdit(value) {
  const text = typeof value?.text === "string" ? value.text.slice(0, MAX_ANSWER) : "";
  const optimized = typeof value?.optimized === "string" ? value.optimized.slice(0, MAX_ANSWER) : "";
  return { text, optimized,
    checkedText: value?.checkedText === true && Boolean(text.trim()),
    checkedOptimized: value?.checkedOptimized === true && Boolean(optimized.trim()),
    usedAi: value?.usedAi === true };
}

function cleanArgument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !METHOD_IDS.has(value.method)) return null;
  if (typeof value.id !== "string" || !value.id || value.id.length > 100) return null;
  const text = typeof value.text === "string" ? value.text.slice(0, MAX_ANSWER) : "";
  const optimized = typeof value.optimized === "string" ? value.optimized.slice(0, MAX_ANSWER) : "";
  return { id: value.id, method: value.method, text, optimized,
    checkedText: value.checkedText === true && Boolean(text.trim()),
    checkedOptimized: value.checkedOptimized === true && Boolean(optimized.trim()),
    usedAi: value.usedAi === true };
}

export function cleanSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exerciseById(value.exerciseId)
    || typeof value.id !== "string" || !value.id || value.id.length > 100
    || !value.claimEdit || typeof value.claimEdit !== "object") return null;
  const raw = Array.isArray(value.arguments) ? value.arguments : [];
  if (raw.length > MAX_ARGUMENTS) return null;      // 超量说明存档被改坏了
  const args = [];
  const seen = new Set();
  for (const item of raw) {
    // 论证块是学生一块一块加出来的，坏掉一块不该把整份草稿连坐作废。
    const block = cleanArgument(item);
    if (!block || seen.has(block.id)) continue;
    seen.add(block.id);
    args.push(block);
  }
  const fusion = typeof value.fusion === "string" ? value.fusion.trim().slice(0, MAX_FUSION) : "";
  return { id: value.id, exerciseId: value.exerciseId, claimEdit: cleanClaimEdit(value.claimEdit),
    arguments: args, fusion, completed: Boolean(fusion),
    startedAt: Number.isFinite(value.startedAt) ? value.startedAt : 0,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0 };
}

export function cleanStore(value) {
  // v1 -> v2：旧的三步草稿和旧记录一律清空，只认新格式。
  // 存储键没变，所以升级后第一次 save() 就把旧数据覆盖掉了，不需要迁移代码。
  if (!value || typeof value !== "object" || value.version !== STORE_VERSION) {
    return { version: STORE_VERSION, session: null, records: [] };
  }
  return { version: STORE_VERSION, session: cleanSession(value.session),
    records: (Array.isArray(value.records) ? value.records : []).map(cleanSession)
      .filter((item) => item?.completed) };
}

export function readStore(raw) {
  try { return cleanStore(JSON.parse(raw)); }
  catch { return cleanStore(null); }
}

// 只留最近的这些条。和生词本的 NOTE_LIMIT 一个思路：本地存储没有上限的话，
// 攒够了就写不进去，而且每次落盘都要把整份记录重新序列化一遍 ——
// 记录越多，打字时那一下就越慢。
export const RECORD_LIMIT = 50;

export function recordCompleted(records, session) {
  const record = cleanSession(session);
  if (!record?.completed) return records;
  return [record, ...records.filter((item) => item.id !== record.id)].slice(0, RECORD_LIMIT);
}
