import { test, expect } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`打字页首次进入与从听写切回时完成测宽、聚焦且无脚本错误（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: /基础练习/ }).click();
    await page.getByRole("button", { name: /打字练习.*按原文逐字输入/ }).click();
    const stage = page.locator("#stage");
    await expect(stage).toBeVisible();
    expect(errors).toEqual([]);
    await expect(stage).toBeFocused();
    expect(await stage.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const first = await stage.locator(".ch").first().textContent();
    await page.keyboard.type(first);
    await expect(stage.locator(".ch.ok")).toHaveCount(1);
    await page.locator("#view-dictation").click();
    await expect(page.locator("#dictation-view")).toBeVisible();
    await page.locator("#view-typing").click();
    await expect(stage).toBeFocused();
    await expect(stage.locator(".ch.ok")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
