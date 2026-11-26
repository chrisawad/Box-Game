import { expect, test, type Page } from "@playwright/test";

async function openWithPendingUpdate(page: Page) {
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
  const download = page.locator("header").getByRole("button", { name: "Game update available", includeHidden: true });
  const update = page.getByRole("dialog", { name: "Game update ready" });
  await expect(download).toBeVisible();
  // Honor any install prompt already on screen before showing an update.
  const install = page.getByRole("dialog", { name: "Install Boxes" });
  if (await install.isVisible()) await install.getByRole("button", { name: "Not now" }).click();
  await expect(update.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(update).toContainText("Updating will exit any active game");
  await update.getByRole("button", { name: "Cancel" }).click();
  await expect(update).toBeHidden();
  await expect(download).toBeInViewport();
  return { download, update };
}

test("cancel preserves the board and confirming a header update exits to setup", async ({ page }) => {
  const { download, update } = await openWithPendingUpdate(page);
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator(".edge:enabled").first().click();
  await page.reload();
  await expect(download).toBeVisible();
  await expect(update).toBeHidden();
  await download.click();
  await expect(update).toBeVisible();
  await update.getByRole("button", { name: "Cancel" }).click();
  await expect(download).toBeFocused();
  await expect(page.locator(".edge.owned")).toHaveCount(1);
  await page.locator(".edge:enabled").first().click();
  await expect(page.locator(".edge.owned")).toHaveCount(2);
  await download.click();
  await page.keyboard.press("Escape");
  await expect(download).toBeFocused();
  await download.click();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    update.getByRole("button", { name: "Update now" }).click(),
  ]);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("button", { name: "Start game" })).toBeVisible();
  await expect(page.locator(".edge")).toHaveCount(0);
  await expect(download).toBeHidden();
  expect(await page.evaluate(() => new URL(navigator.serviceWorker.controller!.scriptURL).search)).toBe("");
  await page.reload();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("button", { name: "Start game" })).toBeVisible();
});

test("cancel keeps both players connected and updating tells the opponent you left", async ({ page, browser, baseURL }, info) => {
  test.skip(info.project.name !== "desktop" || !(process.env.PEER_CI || process.env.ONLINE_SMOKE), "Requires a room service.");
  const { download, update } = await openWithPendingUpdate(page);
  await page.getByRole("button", { name: "Online", exact: true }).click();
  await page.getByRole("button", { name: "Create private room" }).click();
  const code = await page.locator(".room-code").innerText({ timeout: 25000 });
  const guest = await browser.newPage({ baseURL });
  try {
    await guest.goto("./?room=" + code);
    await guest.getByRole("button", { name: "Join room" }).click();
    await expect(page.locator(".transport")).toHaveText("Connected to opponent", { timeout: 25000 });
    await download.click();
    await update.getByRole("button", { name: "Cancel" }).click();
    await page.locator(".edge:enabled").first().click();
    await expect(guest.locator(".edge.owned")).toHaveCount(1);
    await download.click();
    await update.getByRole("button", { name: "Update now" }).click();
    await expect(guest.locator(".turn")).toHaveText("Opponent left");
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("heading", { name: "Play online" })).toBeVisible();
    await expect(download).toBeHidden();
    await page.reload();
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("button", { name: "Create private room" })).toBeVisible();
  } finally {
    await guest.close();
  }
});

test("the top bar shows the share icon and label and shares the public game link", async ({ page }) => {
  const publicURL = "https://boxes.chrisawad.com/";
  await page.goto("./?room=ABC234");
  await page.evaluate(() => Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (data: ShareData) => {
      sessionStorage.setItem("share-url", data.url!);
      throw new DOMException("Canceled", "AbortError");
    },
  }));
  const share = page.getByRole("button", { name: "Share", exact: true });
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 360, 390, 600, 1024, 1366]) {
    await page.setViewportSize({ width, height: 800 });
    for (const updateAvailable of [false, true]) {
      await page.locator("#update").evaluate((button, visible) => {
        button.toggleAttribute("hidden", !visible);
      }, updateAvailable);
      await expect(share.getByText("Share", { exact: true })).toBeInViewport({ ratio: 1 });
      await expect(share.locator("svg")).toBeInViewport({ ratio: 1 });
      for (const control of await page.locator("header .brand, header button:visible").all())
        await expect(control).toBeInViewport({ ratio: 1 });
      const brand = (await page.locator(".brand").boundingBox())!;
      const nav = (await page.locator("header nav").boundingBox())!;
      expect(brand.x + brand.width <= nav.x + 1 || brand.y + brand.height <= nav.y + 1).toBe(true);
    }
  }
  await share.click();
  expect(await page.evaluate(() => sessionStorage.getItem("share-url"))).toBe(publicURL);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined }));
  await share.click();
  const fallback = page.getByRole("dialog", { name: "Share Box Game" });
  await expect(fallback.getByLabel("Send this link to a friend")).toHaveValue(publicURL);
  const email = await fallback.getByRole("link", { name: "Share by email" }).getAttribute("href");
  expect(new URL(email!).searchParams.get("body")).toContain(publicURL);
});
