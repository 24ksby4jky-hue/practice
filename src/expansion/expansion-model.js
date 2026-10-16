import { exerciseById, LEVELS } from "./exercises.js";

export const STORAGE_KEY = "sentenceExpansion:guest";
export const MAX_ANSWER = 1200;
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

export function newSession(exerciseId, level, id, at) {
  const task = exerciseById(exerciseId);
  if (!task) throw new Error("找不到这道练习题。");
  return { id, exerciseId, level: LEVELS.some((item) => item.id === level) ? level : "basic",
    step: 0, draft: task.core, steps: [], feedback: null, reviewedAnswer: "", hint: "", usedAi: false,
    adopted: false, completed: false, startedAt: at, updatedAt: at };
}

export function answerError(value) {
  if (typeof value !== "string" || !value.trim()) return "先写一句英文，再继续。";
  if (value.length > MAX_ANSWER) return `句子最多 ${MAX_ANSWER} 个字符。`;
  if (!/[a-z]/i.test(value)) return "请用英文写出你的句子。";
  return null;
}

export function parseFeedback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.status !== "string" || !value.status.trim() || value.status.length > 2000
    || typeof value.needs_revision !== "boolean"
    || !Array.isArray(value.corrections) || value.corrections.length > 8
    || value.corrections.some((item) => typeof item !== "string" || item.length > 2000)
    || typeof value.suggestion !== "string" || answerError(value.suggestion)
    || typeof value.explanation !== "string" || !value.explanation.trim() || value.explanation.length > 4000) {
    throw new Error("AI 返回的反馈格式不完整，请手动重试。你的原稿已保留。");
  }
  return { status: value.status.trim(), needs_revision: value.needs_revision,
    corrections: value.corrections.map((item) => item.trim()).filter(Boolean),
    suggestion: value.suggestion.trim(), explanation: value.explanation.trim() };
}

export function advanceSession(session, at) {
  if (session.completed) return session;
  const error = answerError(session.draft);
  if (error) throw new Error(error);
  const steps = [...session.steps.slice(0, session.step), {
    answer: session.draft.trim(), feedback: session.feedback, reviewedAnswer: session.reviewedAnswer, hint: session.hint,
    usedAi: session.usedAi, adopted: session.adopted
  }];
  return { ...session, steps, step: Math.min(2, session.step + 1), completed: steps.length === 3,
    draft: session.draft.trim(), feedback: null, reviewedAnswer: "", hint: "", usedAi: false, adopted: false, updatedAt: at };
}

export function previousStep(session) {
  if (session.step <= 0 || session.completed) return session;
  const step = session.step - 1;
  const saved = session.steps[step];
  return { ...session, step, draft: saved.answer, feedback: saved.feedback, hint: saved.hint,
    reviewedAnswer: saved.reviewedAnswer, usedAi: saved.usedAi, adopted: saved.adopted };
}

// 只允许练习字段落盘。AI 配置和 Key 不属于这个存储结构。
export function cleanSession(value) {
  if (!value || typeof value !== "object" || !exerciseById(value.exerciseId)
    || typeof value.id !== "string" || !value.id || value.id.length > 100
    || !LEVELS.some((item) => item.id === value.level)
    || !Number.isInteger(value.step) || value.step < 0 || value.step > 2
    || typeof value.draft !== "string" || value.draft.length > MAX_ANSWER
    || !Array.isArray(value.steps) || value.steps.length > 3
    || value.steps.length < value.step || (value.completed === true && value.steps.length !== 3)) return null;
  const feedback = (item) => { try { return parseFeedback(item); } catch { return null; } };
  const steps = [];
  for (const item of value.steps) {
    if (!item || answerError(item.answer)) return null;
    steps.push({ answer: item.answer, feedback: feedback(item.feedback),
      reviewedAnswer: typeof item.reviewedAnswer === "string" ? item.reviewedAnswer.slice(0, MAX_ANSWER) : "",
      hint: typeof item.hint === "string" ? item.hint.slice(0, 2000) : "",
      usedAi: item.usedAi === true, adopted: item.adopted === true });
  }
  return { id: value.id, exerciseId: value.exerciseId, level: value.level, step: value.step,
    draft: value.draft, steps, feedback: feedback(value.feedback),
    reviewedAnswer: typeof value.reviewedAnswer === "string" ? value.reviewedAnswer.slice(0, MAX_ANSWER) : "",
    hint: typeof value.hint === "string" ? value.hint.slice(0, 2000) : "",
    usedAi: value.usedAi === true, adopted: value.adopted === true, completed: value.completed === true,
    startedAt: Number.isFinite(value.startedAt) ? value.startedAt : 0,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0 };
}

export function cleanStore(value) {
  return { version: 1, session: cleanSession(value?.session),
    records: (Array.isArray(value?.records) ? value.records : []).map(cleanSession)
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
