import { expect, test } from "@playwright/test";

test("a waiting update can be dismissed, reopened in the header and applied during a game", async ({ page }) => {
  // Give the page a previous controlling worker. The normal app entry then registers
  // sw.js as a real waiting update, without changing the server's build mid-test.
  await page.route("**/update-fixture.html", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Previous version</title>",
  }));
  await page.goto("./update-fixture.html");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("./sw.js?previous");
    await navigator.serviceWorker.ready;
  });
  await page.goto("./");
  const download = page.locator("header #update");
  const update = page.getByRole("dialog", { name: "Game update ready" });
  await expect(download).toBeVisible();
  // Honor any install prompt already on screen before showing an update.
  const install = page.getByRole("dialog", { name: "Install Box Game" });
  if (await install.isVisible()) await install.getByRole("button", { name: "Maybe later" }).click();
  await expect(update.getByRole("button", { name: "Later" })).toBeFocused();
  await update.getByRole("button", { name: "Later" }).click();
  await expect(update).toBeHidden();
  await expect(download).toBeInViewport();
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator(".edge:enabled").first().click();
  await page.reload();
  await expect(download).toBeVisible();
  await expect(update).toBeHidden();
  await download.click();
  await expect(update).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(download).toBeFocused();
  await expect(page.locator(".edge.owned")).toHaveCount(1);
  await download.click();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    update.getByRole("button", { name: "Update now" }).click(),
  ]);
  await expect(page.locator(".edge.owned")).toHaveCount(1);
  await expect(download).toBeHidden();
  expect(await page.evaluate(() => new URL(navigator.serviceWorker.controller!.scriptURL).search)).toBe("");
});

test("sharing the game uses its home link and respects cancellation", async ({ page, baseURL }) => {
  await page.goto("./?room=ABC234");
  await page.evaluate(() => Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (data: ShareData) => {
      sessionStorage.setItem("share-url", data.url!);
      throw new DOMException("Canceled", "AbortError");
    },
  }));
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.click();
  expect(await page.evaluate(() => sessionStorage.getItem("share-url"))).toBe(baseURL);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined }));
  await share.click();
  const fallback = page.getByRole("dialog", { name: "Share Box Game" });
  await expect(fallback.getByLabel("Send this link to a friend")).toHaveValue(baseURL!);
});
