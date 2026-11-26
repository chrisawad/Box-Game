import { expect, test, type Page } from "@playwright/test";

async function openInstallHelp(page: Page) {
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("button", { name: "How to install" }).click();
  const guide = page.getByRole("dialog", { name: "How to install" });
  await expect(guide.getByLabel("Game link", { exact: true })).toHaveValue("https://boxes.chrisawad.com/");
  return guide;
}

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
  const guide = page.getByRole("dialog", { name: "How to install" });
  await expect(guide.getByRole("button", { name: "Copy game link" })).toBeVisible();
  await guide.getByRole("button", { name: "Close" }).click();
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
  const icon = page.locator("header .brand img");
  const manifest = await (await page.request.get("./manifest.webmanifest")).json();
  const launcher = manifest.icons.find((entry: { sizes: string }) => entry.sizes === "192x192");
  await expect(icon).toHaveJSProperty("src", new URL(launcher.src, page.url()).href);
  await expect(icon).toHaveJSProperty("naturalWidth", 192);
  await expect(icon).toBeInViewport();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("#install-wrap")).toBeHidden();
  await openInstallHelp(page);
});

test("a browser-confirmed installation stays quiet and manual help remains open", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "getInstalledRelatedApps", {
      value: async () => [{ platform: "webapp", id: new URL("/", location.href).href }],
    });
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true });
  });
  await page.goto("./");
  await expect(page.locator("#install-wrap")).toBeHidden();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#install-wrap")).toBeHidden();
  await expect(page.getByRole("dialog")).toBeHidden();
  const guide = await openInstallHelp(page);
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(guide).toBeVisible();
});

test("install confirmation closes an open offer and fresh eligibility restores the banner", async ({ page }) => {
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
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.locator("#install-wrap")).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByRole("dialog", { name: "Game help" })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
  await expect(page.locator("#install-wrap")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test.describe("Android in-app browser", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel; wv) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36" });
  test("an unmarked webview shows instructions on entry and can reopen them after dismissal", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("box-game.installed", "1");
      sessionStorage.setItem("box-game.install-popup-shown", "1");
      Object.defineProperty(navigator, "standalone", { value: true });
      Object.defineProperty(navigator, "install", { value: undefined });
      Object.defineProperty(navigator, "getInstalledRelatedApps", { value: undefined });
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } } });
      window.addEventListener("beforeinstallprompt", e => {
        e.preventDefault();
        e.stopImmediatePropagation();
      }, { capture: true });
    });
    await page.goto("./");
    const automatic = page.getByRole("dialog", { name: "How to install" });
    await automatic.getByRole("button", { name: "Continue to game" }).click();
    await expect(automatic).toBeHidden();
    const guide = await openInstallHelp(page);
    for (const text of ["Open in Chrome", "paste the link", "Add to Home screen", "app drawer", "Box Game"])
      await expect(guide).toContainText(text);
    await guide.getByRole("button", { name: "Copy game link" }).click();
    await expect(guide.getByRole("status")).toContainText("highlighted game link");
    const field = guide.getByLabel("Game link", { exact: true });
    await expect(field).toBeFocused();
    expect(await field.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart!, input.selectionEnd!))).toBe("https://boxes.chrisawad.com/");
  });
});

test.describe("iPhone", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  test("an unavailable install API opens Safari instructions and copies the public link", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "install", { value: async () => { throw new DOMException("Unavailable", "NotSupportedError"); } });
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (url: string) => sessionStorage.setItem("copied", url) } });
    });
    await page.goto("./");
    await page.getByRole("dialog").getByRole("button", { name: "Install game" }).click();
    const guide = page.getByRole("dialog", { name: "How to install" });
    await expect(guide).toContainText("Safari");
    await expect(guide).toContainText("Add to Home Screen");
    await expect(guide).not.toContainText("app drawer");
    await guide.getByRole("button", { name: "Copy game link" }).click();
    await expect(guide.getByRole("status")).toHaveText("Game link copied.");
    expect(await page.evaluate(() => sessionStorage.getItem("copied"))).toBe("https://boxes.chrisawad.com/");
  });
});

async function dashboardBrowser(page: Page, lookup: "pending" | "denied" | "installed" | "dashboard") {
  await page.addInitScript((lookup) => {
    localStorage.setItem("box-game.installed", "1");
    sessionStorage.setItem("box-game.install-popup-shown", "1");
    sessionStorage.setItem("box-game.install-offered", "1");
    Object.defineProperty(navigator, "install", { value: undefined });
    Object.defineProperty(navigator, "standalone", { value: true });
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = matchMedia(query);
      if (query.includes("display-mode: standalone")) Object.defineProperty(result, "matches", { value: true });
      return result;
    };
    window.addEventListener("beforeinstallprompt", event => {
      if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, { capture: true });
    const installedApps = () => [{
      platform: "webapp",
      url: lookup === "dashboard" ? new URL("/Games-Dashboard/manifest.webmanifest", location.href).href
        : document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href,
    }];
    Object.defineProperty(navigator, "getInstalledRelatedApps", {
      value: async () => {
        if (lookup === "denied") throw new DOMException("Unavailable", "NotAllowedError");
        if (lookup === "pending") await new Promise(resolve =>
          window.addEventListener("complete-related-lookup", resolve, { once: true }));
        document.documentElement.dataset.installChecked = "true";
        return installedApps();
      },
    });
  }, lookup);
}

test.describe("Games Dashboard on Android", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36" });

  test("a pending check shows the guide and a late Box Game confirmation closes it", async ({ page }) => {
    await dashboardBrowser(page, "pending");
    await page.addInitScript(() => {
      if (navigator.serviceWorker) Object.defineProperty(navigator.serviceWorker, "getRegistration", {
        value: () => new Promise(() => {}),
      });
    });
    await page.goto("./#from=games-dashboard");
    const guide = page.getByRole("dialog", { name: "How to install" });
    await expect(guide).toContainText("Open in Chrome");
    await expect(guide.getByLabel("Game link", { exact: true })).toHaveValue("https://boxes.chrisawad.com/");
    expect(new URL(page.url()).hash).toBe("");
    await page.evaluate(() => window.dispatchEvent(new Event("complete-related-lookup")));
    await expect(guide).toBeHidden();
    await expect(page.locator("#install-wrap")).toBeHidden();
    await openInstallHelp(page);
  });

  test("a confirmed Box Game installation skips automatic offers from the dashboard", async ({ page }) => {
    await dashboardBrowser(page, "installed");
    await page.goto("./#from=games-dashboard");
    await expect(page.locator("html")).toHaveAttribute("data-install-checked", "true");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("#install-wrap")).toBeHidden();
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.locator(".edge:enabled").first()).toBeVisible();
  });

  test("a dashboard installation keeps the guide available and a late native prompt works", async ({ page }) => {
    await dashboardBrowser(page, "dashboard");
    await page.goto("./#from=games-dashboard");
    const guide = page.getByRole("dialog", { name: "How to install" });
    await expect(guide).toBeVisible();
    const install = guide.getByRole("button", { name: "Install game" });
    await expect(install).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => { document.documentElement.dataset.nativeGesture = String(navigator.userActivation.isActive); },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    })));
    await install.click();
    await expect(page.locator("html")).toHaveAttribute("data-native-gesture", "true");
    await expect(guide).toBeHidden();
    await expect(page.locator("#install-wrap")).toBeHidden();
  });
});

test.describe("iPhone in-app browser", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram" });
  test("Safari instructions open with no install APIs on both marked and unmarked visits", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("box-game.installed", "1");
      sessionStorage.setItem("box-game.install-popup-shown", "1");
      Object.defineProperty(navigator, "install", { value: undefined });
      Object.defineProperty(navigator, "getInstalledRelatedApps", { value: undefined });
      Object.defineProperty(navigator, "standalone", { value: true });
      window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); e.stopImmediatePropagation(); }, { capture: true });
    });
    for (const entry of ["./#from=games-dashboard", "./"]) {
      await page.goto(entry);
      const guide = page.getByRole("dialog", { name: "How to install" });
      await expect(guide.getByRole("heading", { name: "How to install" })).toBeInViewport();
      await expect(guide).toContainText(/Safari.*Share.*Add to Home Screen.*tap Add/);
      await guide.getByRole("button", { name: "Continue to game" }).click();
      await page.goto("about:blank");
    }
  });
});

test.describe("Games Dashboard on iPad", () => {
  test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15" });
  test("a denied lookup shows Safari steps on each visit, preserves deep links and leaves invites quiet", async ({ page }) => {
    await dashboardBrowser(page, "denied");
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { value: "MacIntel" });
      Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
    });
    await page.goto("./#puzzle=A%2Fb&from=games-dashboard");
    const guide = page.getByRole("dialog", { name: "How to install" });
    await expect(guide).toContainText(/Safari.*Share.*Add to Home Screen.*tap Add/);
    expect(new URL(page.url()).hash).toBe("#puzzle=A%2Fb");
    await guide.getByRole("button", { name: "Continue to game" }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(guide).toBeHidden();
    await openInstallHelp(page);
    await guide.getByRole("button", { name: "Close" }).click();
    await page.goto("about:blank");
    await page.goto("./#from=games-dashboard");
    await expect(guide).toBeVisible();
    await page.goto("./#from=games-dashboard&room=ABC234");
    await expect(page.getByLabel("Room code")).toHaveValue("ABC234");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(new URL(page.url()).hash).toBe("#room=ABC234");
  });
});
