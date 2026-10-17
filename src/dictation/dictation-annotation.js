import { annotationState, loadAnnotation } from "../dictionary-annotations.js";
import { renderDictionaryEntries } from "../reading/dictionary.js";

// 注释独立于答题状态；旧题的异步结果不能写进下一题的答案区域。
export function mountDictationAnnotation(host, entry, onExample) {
  let closed = false;
  let expanded = false;
  let exampleText = "";
  let state = annotationState(entry.word);
  const make = (tag, className) => {
    const node = document.createElement(tag); node.className = className; return node;
  };
  const status = make("p", "dict-annotation-status"); status.setAttribute("role", "status");
  const meaning = make("p", "dict-meaning");
  const example = make("p", "example dict-collins-example");
  const translation = make("p", "dict-example-translation");
  const tools = make("div", "dict-annotation-tools");
  const toggle = make("button", "dict-annotation-toggle"); toggle.type = "button";
  toggle.id = "dict-annotation-toggle";
  toggle.setAttribute("aria-controls", "dict-annotation-full");
  const retry = make("button", "dict-annotation-retry"); retry.type = "button";
  retry.id = "dict-annotation-retry"; retry.textContent = "重新加载柯林斯";
  const full = make("section", "dict-annotation-full dictionary-definition");
  full.id = "dict-annotation-full";
  tools.append(toggle, retry);
  host.replaceChildren(status, meaning, example, translation, tools, full);

  function paint() {
    if (closed) return;
    const found = Boolean(state?.preview);
    const pending = !state || state.status === "loading";
    status.textContent = found ? "柯林斯双解"
      : pending ? "正在读取柯林斯注释…"
      : state.status === "error" ? "柯林斯暂时无法加载，以下为听写词表注释。"
      : "柯林斯未收录这个词，以下为听写词表注释。";
    if (found && state.result.matched !== entry.word) status.textContent += ` · ${entry.word} → ${state.result.matched}`;
    meaning.textContent = pending ? "" : found ? state.preview.meaning : `${entry.pos || ""} ${entry.meaning || ""}`.trim();
    exampleText = pending ? "" : found ? state.preview.example : entry.example || "";
    example.textContent = exampleText;
    translation.textContent = found ? state.preview.exampleTranslation || "" : "";
    example.hidden = !exampleText; translation.hidden = !translation.textContent;
    onExample(exampleText);
    retry.hidden = state?.status !== "error";
    toggle.hidden = !found;
    toggle.textContent = expanded ? "收起全部注释" : "查看全部注释";
    toggle.setAttribute("aria-expanded", String(expanded && found));
    full.hidden = !expanded || !found;
    if (!full.hidden) renderDictionaryEntries(full, state.result, { links: false });
    else full.replaceChildren();
  }
  async function load(retry = false) {
    const request = loadAnnotation(entry.word, { retry });
    state = annotationState(entry.word);
    paint();
    const result = await request;
    if (closed || !host.isConnected) return;
    state = result; paint();
  }
  toggle.addEventListener("click", () => { expanded = !expanded; paint(); });
  retry.addEventListener("click", () => { void load(true); });
  paint();
  if (!state || state.status === "loading") void load();
  return { example() { return exampleText; }, close() { closed = true; } };
}
