import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { clampPage, readPdfPage, pdfProgress } from "./pdf-model.js";
import { progressKey } from "./reading-model.js";
import { writeJson } from "../typing/typing-model.js";

GlobalWorkerOptions.workerSrc = workerUrl;

export function createPdfReader(host, title, id) {
  let closed = false;
  let loadingTask, pdf, renderTask, textLayer, resizeTimer;
  let revision = 0;
  let current = 1;
  let zoom = 1;
  const bar = document.createElement("div");
  bar.className = "reader-bar";
  const name = document.createElement("span");
  name.className = "reader-title";
  name.textContent = title;
  const position = document.createElement("span");
  position.className = "reader-pos";
  position.id = "reader-pos";
  position.setAttribute("aria-live", "polite");
  const makeButton = (id, text, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = "reader-tool";
    button.textContent = text;
    button.addEventListener("click", action);
    return button;
  };
  const previous = makeButton("reader-prev", "上一页", () => turn(-1));
  const next = makeButton("reader-next", "下一页", () => turn(1));
  const pageLabel = document.createElement("label");
  pageLabel.className = "pdf-page-label";
  pageLabel.textContent = "页码 ";
  const pageInput = document.createElement("input");
  pageInput.id = "pdf-page";
  pageInput.type = "number";
  pageInput.min = "1";
  pageInput.value = "1";
  pageInput.disabled = true;
  pageInput.addEventListener("change", () => goTo(pageInput.value));
  pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") goTo(pageInput.value);
  });
  pageLabel.append(pageInput);
  const scaleLabel = document.createElement("label");
  scaleLabel.className = "pdf-page-label";
  scaleLabel.textContent = "缩放 ";
  const scale = document.createElement("select");
  scale.id = "pdf-zoom";
  for (const [value, label] of [[1, "适合宽度"], [0.75, "75%"], [1.25, "125%"], [1.5, "150%"], [2, "200%"]]) {
    scale.add(new Option(label, String(value)));
  }
  scale.addEventListener("change", () => { zoom = Number(scale.value); requestRender(); });
  scaleLabel.append(scale);
  bar.append(name, position, pageLabel, scaleLabel, previous, next);
  const progress = document.createElement("div");
  progress.className = "reader-progress";
  const fill = document.createElement("span");
  fill.className = "reader-progress-fill";
  progress.append(fill);
  const stage = document.createElement("div");
  stage.className = "reader-stage pdf-stage";
  stage.id = "reader-stage";
  stage.tabIndex = 0;
  stage.setAttribute("aria-label", "PDF 页面，左右方向键翻页");
  const status = document.createElement("p");
  status.className = "reader-hint";
  status.setAttribute("role", "status");
  status.textContent = "正在打开 PDF…";
  const note = document.createElement("p");
  note.className = "reader-hint";
  note.textContent = "PDF 保留原始版式，可翻页、输入页码和缩放；扫描件中的文字无法直接选择。";
  host.replaceChildren(bar, progress, status, stage, note);
  previous.disabled = next.disabled = true;

  function requestRender() { void renderPage().catch(showError); }
  function showError(error) {
    if (closed || error?.name === "RenderingCancelledException") return;
    status.textContent = error?.name === "PasswordException"
      ? "这份 PDF 需要密码，请先解密后再打开。"
      : `无法显示 PDF：${error?.message || "文件可能已损坏，请选择另一份文件。"}`;
    stage.setAttribute("aria-busy", "false");
  }
  async function renderPage() {
    if (!pdf || closed) return;
    const token = ++revision;
    const pageNumber = current;
    renderTask?.cancel();
    textLayer?.cancel();
    stage.setAttribute("aria-busy", "true");
    status.textContent = "正在显示页面…";
    const page = await pdf.getPage(pageNumber);
    if (closed || token !== revision) return;
    const base = page.getViewport({ scale: 1 });
    const fit = Math.max(100, stage.clientWidth - 32) / base.width;
    const viewport = page.getViewport({ scale: Math.min(4, fit * zoom) });
    // 限制超大页面的画布占用，同时保留高分屏清晰度。
    const ratio = Math.min(window.devicePixelRatio || 1, 2,
      Math.sqrt(16000000 / (viewport.width * viewport.height)));
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-sheet";
    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;
    wrapper.style.setProperty("--total-scale-factor", viewport.scale);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute("aria-label", `第 ${pageNumber} 页`);
    const text = document.createElement("div");
    text.className = "pdf-text-layer";
    wrapper.append(canvas, text);
    renderTask = page.render({
      canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
    });
    await renderTask.promise;
    if (closed || token !== revision) return;
    stage.replaceChildren(wrapper);
    stage.scrollTop = stage.scrollLeft = 0;
    position.textContent = `${pageNumber} / ${pdf.numPages} 页`;
    pageInput.value = String(pageNumber);
    previous.disabled = pageNumber <= 1;
    next.disabled = pageNumber >= pdf.numPages;
    const progress = pdfProgress(pageNumber, pdf.numPages);
    fill.style.width = `${progress.fraction * 100}%`;
    if (id && document.body.dataset.view === "reader") writeJson(localStorage, progressKey(id), progress);
    status.textContent = "";
    stage.setAttribute("aria-busy", "false");
    textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
    await textLayer.render();
  }
  function goTo(page) {
    if (!pdf || closed) return;
    current = clampPage(page, pdf.numPages);
    requestRender();
  }
  function turn(delta) { goTo(current + delta); }
  let lastWidth = stage.clientWidth;
  const observer = new ResizeObserver(() => {
    if (!stage.clientWidth || stage.clientWidth === lastWidth) return;
    lastWidth = stage.clientWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(requestRender, 150);
  });
  observer.observe(stage);
  return {
    turn,
    async open(file) {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        if (closed) return false;
        const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
        loadingTask = getDocument({ data, cMapUrl: `${assets}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`, isEvalSupported: false });
        pdf = await loadingTask.promise;
        if (closed) return false;
        current = readPdfPage(id ? localStorage.getItem(progressKey(id)) : null, pdf.numPages);
        pageInput.max = String(pdf.numPages);
        pageInput.disabled = false;
        await renderPage();
        return !closed;
      } catch (error) { showError(error); return false; }
    },
    close() {
      closed = true;
      revision += 1;
      clearTimeout(resizeTimer);
      observer.disconnect();
      renderTask?.cancel();
      textLayer?.cancel();
      void loadingTask?.destroy().catch(() => {});
    }
  };
}
