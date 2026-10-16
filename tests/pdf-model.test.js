import test from "node:test";
import assert from "node:assert/strict";
import { clampPage, readPdfPage, pdfProgress } from "../src/reading/pdf-model.js";
import { parseProgress } from "../src/reading/reading-model.js";

test("PDF 页码不能越过首尾，非法输入退回第一页", () => {
  for (const [value, expected] of [[0, 1], [-10, 1], [2.8, 2], [50, 8], [NaN, 1], [Infinity, 1], ["3", 3]]) {
    assert.equal(clampPage(value, 8), expected);
  }
});

test("PDF 重新打开恢复页码，坏记录和非 PDF 记录安全回退", () => {
  assert.equal(readPdfPage('{"page":5,"fraction":0.5}', 9), 5);
  assert.equal(readPdfPage('{"page":15}', 9), 9);
  for (const raw of [null, "", "broken", '{"fraction":0.5}', "0.5", "[]"]) {
    assert.equal(readPdfPage(raw, 9), 1);
  }
});

test("PDF 的精确页码和书架百分比兼容，包括单页文件", () => {
  const saved = pdfProgress(3, 5);
  assert.deepEqual(saved, { page: 3, fraction: 0.5, cfi: null });
  assert.deepEqual(parseProgress(JSON.stringify(saved)), { fraction: 0.5, cfi: null });
  assert.equal(pdfProgress(1, 5).fraction, 0);
  assert.equal(pdfProgress(5, 5).fraction, 1);
  assert.equal(pdfProgress(1, 1).fraction, 1);
});
