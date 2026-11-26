import { expect, test } from "@playwright/test";

test("rotate an active match and play the bottom edge without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  for (const [width, height] of [[844, 390], [667, 375], [568, 320]]) {
    await page.setViewportSize({ width, height });
    for (const selector of ["header", ".scores", ".turn", ".board-shell", ".progress-row", "[data-action=exit]"]) {
      await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.locator('[data-edge="h_4_3"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-edge="h_4_3"]')).toHaveClass(/owned/);
  await expect(page.locator(".progress-row")).toContainText("1 / 40 lines");
});

for (const [columns, rows] of [[2, 10], [10, 2]]) {
  test(`a ${columns} × ${rows} board keeps square cells in landscape`, async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
    await page.goto("./");
    for (const [dimension, size] of [["columns", columns], ["rows", rows]] as const) {
      const button = page.getByRole("button", { name: (size > 4 ? "More " : "Fewer ") + dimension });
      for (let step = 0; step < Math.abs(size - 4); step++) await button.click();
    }
    await page.getByRole("button", { name: "Start game" }).click();
    await page.setViewportSize({ width: 740, height: 320 });
    await expect(page.locator(".board-shell")).toBeInViewport({ ratio: 1 });
    const board = (await page.locator(".board").boundingBox())!;
    expect(board.width / columns).toBeGreaterThan(12);
    expect(board.width / columns).toBeCloseTo(board.height / rows, 1);
  });
}
