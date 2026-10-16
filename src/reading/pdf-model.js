// 页码单独保存；fraction 同时沿用书架现有的百分比显示。
export function clampPage(page, total) {
  const value = Number(page);
  return Math.min(Math.max(1, total), Math.max(1, Number.isFinite(value) ? Math.floor(value) : 1));
}

export function readPdfPage(raw, total) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return clampPage(value?.page, total);
  } catch { return 1; }
}

export function pdfProgress(page, total) {
  const current = clampPage(page, total);
  return { page: current, fraction: total > 1 ? (current - 1) / (total - 1) : 1, cfi: null };
}
