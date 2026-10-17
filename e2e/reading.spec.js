import { test, expect } from "@playwright/test";
import { dictionaryShard } from "../src/reading/dictionary-model.js";
import { dictionaryRoutes } from "./fixtures/dictionary.js";
async function openReading(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /阅读.*读自己的书/ }).click();
}
async function openMarkdown(page) {
  await openReading(page);
  await page.locator("#reading-file").setInputFiles({ name: "test.md", mimeType: "text/markdown",
    buffer: Buffer.from("# Reading\n\nChildren read books.\n\n## Another section\n\nA book opens a new world.\n") });
  await expect(page.locator("#reader-next")).toBeEnabled();
}

for (const secure of [false, true]) {
  test(`目录选择器不可用时区分 HTTP 限制与浏览器能力，并保留单文件阅读（secure=${secure}）`, async ({ page }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(window, "isSecureContext", { value });
      Object.defineProperty(window, "showDirectoryPicker", { value: undefined });
    }, secure);
    await openReading(page);
    await expect(page.locator("#reading-folder")).toBeHidden();
    await expect(page.locator("#reading-note")).toContainText(secure ? "这个浏览器不能选文件夹" : "HTTPS");
    await expect(page.locator("#reading-file")).toBeEnabled();
    await page.locator("#reading-file").setInputFiles({ name: "local.md", mimeType: "text/markdown", buffer: Buffer.from("# Local book\n\nReading still works.") });
    await expect(page.locator("#reader-next")).toBeEnabled();
    await expect(page.locator("#reader-title")).toHaveText("local");
  });
}
function pdfBuffer() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>"];
  for (let index = 0; index < 2; index += 1) {
    const stream = `BT /F1 24 Tf 50 700 Td (${index ? "A book opens a new world." : "Children read books."}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents ${index ? 6 : 4} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

test("电子书占满视口，侧栏可收起，点击词语自动展开词典并显示例句", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await dictionaryRoutes(page);
  await openMarkdown(page);
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator("#reader-sidebar")).toBeVisible();
  const stage = await page.locator("#reader-stage").boundingBox();
  expect(stage.height).toBeGreaterThan(750);
  await page.locator("#reader-sidebar-toggle").click();
  await expect(page.locator("#reader-sidebar")).toBeHidden();
  await expect(page.locator("#reader-stage")).toHaveCSS("height", /.+/);
  const frame = page.locator("foliate-view").locator("iframe").first().contentFrame();
  await frame.getByText("Children read books.", { exact: true }).click({ position: { x: 20, y: 12 } });
  await expect(page.locator("#reader-sidebar")).toBeVisible();
  await expect(page.locator("#reader-tab-dictionary")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#dictionary-definition")).toContainText("儿童");
  await expect(page.locator("#dictionary-definition .C1_sentence_en")).toHaveText("The child reads a book.");
  await expect(page.locator("#dictionary-status")).toContainText("children → child");
  await page.locator("#reader-tab-toc").click();
  await expect(page.locator("#reader-side-toc")).toContainText("Another section");
  await page.locator("#reader-tab-dictionary").click();
  await expect(page.locator("#dictionary-definition")).toContainText("儿童");
  await page.locator("#reader-back").click();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator("#reading-file")).toBeVisible();
  expect(errors).toEqual([]);
});

test("PDF 有真实页面缩略图、页码跳转和点击查词", async ({ page }) => {
  await dictionaryRoutes(page);
  await openReading(page);
  await page.locator("#reading-file").setInputFiles({ name: "test.pdf", mimeType: "application/pdf", buffer: pdfBuffer() });
  await expect(page.locator("#reader-pos")).toContainText("1 / 2");
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached();
  await expect(page.locator(".reader-page-item")).toHaveCount(2);
  await expect(page.locator(".reader-page-preview canvas").first()).toBeAttached();
  const coordinates = await page.locator(".pdf-text-layer span").filter({ hasText: "Children" }).first().evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 8);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(coordinates.x, coordinates.y);
  await expect(page.locator("#dictionary-definition")).toContainText("儿童");
  await page.locator("#reader-tab-pages").click();
  await page.getByRole("button", { name: "跳到第 2 页", exact: true }).click();
  await expect(page.locator("#reader-pos")).toContainText("2 / 2");
  await page.locator("#reader-tab-toc").click();
  await expect(page.locator("#reader-side-toc")).toContainText("没有内置目录");
  await page.locator("#reader-sidebar-toggle").click();
  await expect(page.locator("#reader-sidebar")).toBeHidden();
});

test("窄屏侧栏覆盖打开且可收起，空结果与恶意词条均安全处理", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await dictionaryRoutes(page);
  await openMarkdown(page);
  await expect(page.locator("#reader-sidebar")).toBeHidden();
  await page.locator("#reader-sidebar-toggle").click();
  await page.locator("#reader-tab-dictionary").click();
  await page.locator("#dictionary-query").fill("unknownword");
  await page.locator("#dictionary-query").press("Enter");
  await expect(page.locator("#dictionary-status")).toContainText("未收录");
  await page.route(`**/dictionaries/collins/${dictionaryShard("testattack")}.json*`, (route) => route.fulfill({ json: {
    testattack: [{ word: "testattack", html: '<script>window.dictionaryAttack=true</script><img src=x onerror="window.dictionaryAttack=true"><p>安全词条</p>' }]
  } }));
  await page.locator("#dictionary-query").fill("testattack");
  await page.locator("#dictionary-query").press("Enter");
  await expect(page.locator("#dictionary-definition")).toContainText("安全词条");
  await expect(page.locator("#dictionary-definition script, #dictionary-definition img")).toHaveCount(0);
  expect(await page.evaluate(() => window.dictionaryAttack)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#reader-sidebar-toggle").click();
  await expect(page.locator("#reader-sidebar")).toBeHidden();
});
