import { expect, test } from "@playwright/test";

test("dismissing the popup leaves a working install banner during a match", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "install", { value: undefined });
    window.addEventListener("beforeinstallprompt", (e) => {
      if (e.isTrusted) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, { capture: true });
  });
  await page.goto("./");
  const popup = page.getByRole("dialog", { name: "Install Box Game" });
  await expect(popup.getByRole("button", { name: "Install game" })).toBeFocused();
  await popup.getByRole("button", { name: "Maybe later" }).click();
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator(".edge:enabled").first().click();
  await page.reload();
  await expect(page.locator(".edge.owned")).toHaveCount(1);
  await expect(popup).toBeHidden();
  const banner = page.getByRole("complementary", { name: "Install Box Game" });
  await expect(banner).toBeInViewport();
  await banner.getByRole("button", { name: "Install game" }).click();
  await expect(popup).toContainText("browser’s menu");
  await popup.getByRole("button", { name: "Close" }).click();
  await banner.getByRole("button", { name: "Dismiss install offer" }).click();
  await expect(page.locator("#install-wrap .install-copy")).toBeHidden();
  await expect(page.locator("footer #install")).toBeVisible();
  await page.reload();
  await expect(page.locator("footer #install")).toBeVisible();
  await expect(popup).toBeHidden();
});

test("a banner click opens the native install prompt and can be retried after cancellation", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "install", { value: undefined }),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "Maybe later" }).click();
  for (const outcome of ["dismissed", "accepted"]) {
    await page.evaluate((outcome) => {
      const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          document.documentElement.dataset.installGesture = String(navigator.userActivation.isActive);
        },
        userChoice: Promise.resolve({ outcome }),
      });
      window.dispatchEvent(event);
    }, outcome);
    await page.locator("#install").click();
    await expect(page.locator("html")).toHaveAttribute("data-install-gesture", "true");
    if (outcome === "dismissed") {
      await expect(page.locator("#notice")).toContainText("Installation canceled");
      await expect(page.locator("#install-wrap")).toBeVisible();
    }
  }
  await expect(page.locator("#install-wrap")).toBeHidden();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("an installed home-screen launch can play immediately", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", { value: true }),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator(".edge:enabled").first()).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("#install-wrap")).toBeHidden();
});

test("waits for the browser to identify an already-installed copy", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "getInstalledRelatedApps", {
      value: () => new Promise((resolve) => {
        window.addEventListener("finish-install-check", () => {
          resolve([{ platform: "webapp", id: new URL("./", location.href).href }]);
        }, { once: true });
      }),
    });
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true });
  });
  await page.goto("./");
  await expect(page.locator("#install-wrap")).toBeHidden();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("finish-install-check")));
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#install-wrap")).toBeHidden();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("installing elsewhere closes an open offer and persists across reloads", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("beforeinstallprompt", e => {
      if (e.isTrusted) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, { capture: true });
  });
  await page.goto("./");
  await expect(page.getByRole("dialog", { name: "Install Box Game" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("#install-wrap")).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "How to play" }).click();
  await expect(page.locator("#install-wrap")).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByRole("dialog", { name: "How to play" })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
  await expect(page.locator("#install-wrap")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});
