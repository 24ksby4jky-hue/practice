import { lookupWord, dictionaryPreview } from "./reading/dictionary.js";
import { normalizeDictionaryKey } from "./reading/dictionary-model.js";

// 听写与生词本共用注释缓存，同时最多查四个词，不一次请求整本词库。
const states = new Map();
const queue = [];
let running = 0;

function drain() {
  while (running < 4 && queue.length) {
    running += 1;
    const run = queue.shift();
    void run().finally(() => { running -= 1; drain(); });
  }
}

export function annotationState(word) { return states.get(normalizeDictionaryKey(word)); }

export function loadAnnotation(word, { retry = false } = {}) {
  const key = normalizeDictionaryKey(word);
  const previous = states.get(key);
  if (previous && !(retry && previous.status === "error")) return previous.promise;
  const state = { status: "loading" };
  states.set(key, state);
  state.promise = new Promise((resolve) => {
    queue.push(async () => {
      try {
        state.result = await lookupWord(key);
        state.preview = state.result?.entries.length ? dictionaryPreview(state.result) : null;
        state.status = "ready";
      } catch {
        state.status = "error";
      }
      // 缓存只在内存里留最近的词，完整词条不写入 localStorage。
      if (states.size > 80) for (const [oldKey, oldState] of states) {
        if (states.size <= 80) break;
        if (oldState.status !== "loading" && oldKey !== key) states.delete(oldKey);
      }
      resolve(state);
    });
  });
  drain();
  return state.promise;
}
