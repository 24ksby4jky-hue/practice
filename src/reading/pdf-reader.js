import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { clampPage, readPdfPage, pdfProgress } from "./pdf-model.js";
import { progressKey } from "./reading-model.js";
import { writeJson } from "../typing/typing-model.js";
import { createWorkspace } from "./workspace.js";

GlobalWorkerOptions.workerSrc = workerUrl;

export function createPdfReader(host, title, id) {
  let closed = false;
  let loadingTask, pdf, renderTask, textLayer, resizeTimer;
  let revision = 0;
  let current = 1;
  let zoom = 1;
  let outline;
  let pageBatch = 0;
  let thumbnailObserver;
  const thumbnails = new Map();
  const thumbnailTasks = new Set();
  const bar = document.createElement("div");
  bar.className = "reader-bar";
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
  scale.addEventListener("change", () => { zoom = Number(scale.value); requestRender(true); });
  scaleLabel.append(scale);
  bar.append(position, pageLabel, scaleLabel, previous, next);
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
  const workspace = createWorkspace(host, { title, toolbar: bar, stage, status,
    onPages: paintPages, onToc: paintOutline });
  workspace.shell.append(progress);
  workspace.bindWords(stage);
  previous.disabled = next.disabled = true;

  function requestRender(preserve = false) { void renderPage(preserve).catch(showError); }
  function showError(error) {
    if (closed || error?.name === "RenderingCancelledException") return;
    status.textContent = error?.name === "PasswordException"
      ? "这份 PDF 需要密码，请先解密后再打开。"
      : `无法显示 PDF：${error?.message || "文件可能已损坏，请选择另一份文件。"}`;
    stage.setAttribute("aria-busy", "false");
  }
  async function renderPage(preserve = false) {
    if (!pdf || closed) return;
    const token = ++revision;
    const pageNumber = current;
    const oldHeight = stage.querySelector(".pdf-sheet")?.clientHeight || 1;
    const scrollFraction = stage.scrollTop / oldHeight;
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
    stage.scrollTop = preserve ? scrollFraction * viewport.height : 0;
    stage.scrollLeft = 0;
    position.textContent = `${pageNumber} / ${pdf.numPages} 页`;
    workspace.position(position.textContent);
    workspace.refresh();
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
    pageBatch = Math.floor((current - 1) / 40);
    requestRender();
  }
  function turn(delta) { goTo(current + delta); }

  function message(text) {
    const item = document.createElement("p"); item.className = "reader-hint"; item.textContent = text; return item;
  }
  function paintPages(box) {
    thumbnailObserver?.disconnect();
    if (!pdf) { box.append(message("正在读取 PDF 页面…")); return; }
    const start = pageBatch * 40 + 1;
    const end = Math.min(pdf.numPages, start + 39);
    box.append(message(`共 ${pdf.numPages} 页 · 显示 ${start}–${end} 页`));
    const grid = document.createElement("div"); grid.className = "reader-page-grid";
    thumbnailObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbnailObserver.unobserve(entry.target);
        void paintThumbnail(entry.target, Number(entry.target.dataset.page));
      }
    }, { root: box, rootMargin: "120px" });
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      const item = document.createElement("button"); item.type = "button";
      item.className = "reader-page-item"; item.dataset.page = String(pageNumber);
      item.classList.toggle("current", pageNumber === current);
      item.setAttribute("aria-label", `跳到第 ${pageNumber} 页`);
      if (pageNumber === current) item.setAttribute("aria-current", "page");
      const preview = document.createElement("span"); preview.className = "reader-page-preview";
      item.append(preview, document.createTextNode(String(pageNumber)));
      item.addEventListener("click", () => goTo(pageNumber));
      grid.append(item); thumbnailObserver.observe(item);
    }
    box.append(grid);
    if (pdf.numPages > 40) {
      const nav = document.createElement("div"); nav.className = "reader-page-batches";
      for (const [label, delta] of [["前 40 页", -1], ["后 40 页", 1]]) {
        const item = document.createElement("button"); item.type = "button"; item.textContent = label;
        item.disabled = delta < 0 ? start <= 1 : end >= pdf.numPages;
        item.addEventListener("click", () => { pageBatch += delta; workspace.refresh(); });
        nav.append(item);
      }
      box.append(nav);
    }
  }
  async function paintThumbnail(item, pageNumber) {
    if (closed || !pdf) return;
    const preview = item.querySelector(".reader-page-preview");
    if (thumbnails.has(pageNumber)) { preview.append(thumbnails.get(pageNumber)); return; }
    try {
      const page = await pdf.getPage(pageNumber);
      if (closed) return;
      const viewport = page.getViewport({ scale: 110 / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const task = page.render({ canvas, viewport }); thumbnailTasks.add(task);
      try { await task.promise; } finally { thumbnailTasks.delete(task); }
      if (closed) return;
      thumbnails.set(pageNumber, canvas);
      preview.append(canvas);
    } catch { /* 一个缩略图失败不影响正文 */ }
  }
  function paintOutline(box) {
    if (!outline) { box.append(message(outline === null ? "这份 PDF 没有内置目录，请用“页面”或页码跳转。" : "正在读取目录…")); return; }
    const add = (items, depth = 0) => {
      for (const entry of items) {
        const item = document.createElement("button"); item.type = "button"; item.className = "toc-item";
        item.style.setProperty("--depth", String(depth)); item.textContent = entry.title || "未命名章节";
        item.addEventListener("click", async () => {
          try {
            const dest = typeof entry.dest === "string" ? await pdf.getDestination(entry.dest) : entry.dest;
            if (!dest || closed) return;
            const index = typeof dest[0] === "number" ? dest[0] : await pdf.getPageIndex(dest[0]);
            if (!closed) goTo(index + 1);
          } catch { status.textContent = "无法跳转到该目录项，请使用页码。"; }
        });
        item.disabled = !entry.dest;
        box.append(item);
        if (entry.items?.length) add(entry.items, depth + 1);
      }
    };
    add(outline);
  }
  let lastWidth = stage.clientWidth;
  const observer = new ResizeObserver(() => {
    if (!stage.clientWidth || stage.clientWidth === lastWidth) return;
    lastWidth = stage.clientWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => requestRender(true), 150);
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
        pageBatch = Math.floor((current - 1) / 40);
        pageInput.max = String(pdf.numPages);
        pageInput.disabled = false;
        await renderPage();
        try { outline = await pdf.getOutline(); } catch { outline = null; }
        if (!outline?.length) outline = null;
        if (!closed) workspace.refresh();
        return !closed;
      } catch (error) { showError(error); return false; }
    },
    close() {
      closed = true;
      revision += 1;
      clearTimeout(resizeTimer);
      observer.disconnect();
      thumbnailObserver?.disconnect();
      for (const task of thumbnailTasks) task.cancel();
      thumbnails.clear();
      workspace.close();
      renderTask?.cancel();
      textLayer?.cancel();
      void loadingTask?.destroy().catch(() => {});
    }
  };
}
