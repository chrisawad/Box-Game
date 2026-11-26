import { expect, test, type Page } from "@playwright/test";

const gameURL = "https://boxes.chrisawad.com/";
const description = "Keep Boxes on your home screen and play offline after your first visit.";
const installDialog = (page: Page) => page.getByRole("dialog", { name: "Install Boxes" });
const installIcon = (page: Page) => page.locator("header #install");

async function withoutNativeInstall(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "install", { value: undefined });
    window.addEventListener("beforeinstallprompt", e => {
      if (e.isTrusted) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, { capture: true });
  });
}

test("dismiss for this visit, reopen from the icon, and offer again on navigation, reload, Back and a new tab", async ({ page, context, baseURL }) => {
  await withoutNativeInstall(page);
  await page.goto("./");
  const dialog = installDialog(page);
  const dismiss = () => dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog.getByText(description, { exact: true })).toBeVisible();
  await expect(dialog.getByText("Open Boxes in Chrome or Edge and choose the install option in the address bar or browser menu.", { exact: true })).toBeVisible();
  await dismiss();
  await expect(installIcon(page).locator("svg")).toBeInViewport({ ratio: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "How to play" }).click();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).toBeHidden();
  await installIcon(page).click();
  await expect(dialog.getByText(description, { exact: true })).toBeVisible();
  await dismiss();
  await page.goto("./#from=games-dashboard");
  await dismiss();
  await page.reload();
  await dismiss();
  await page.goto("about:blank");
  await page.goBack();
  await dismiss();
  // Exercise the cached-return path even in runners which disable the back/forward cache.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await dismiss();
  const tab = await context.newPage();
  await tab.goto(new URL("./", baseURL).href);
  await expect(installDialog(tab)).toBeVisible();
  await tab.close();
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator(".edge:enabled").first().click();
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(page.locator(".edge.owned")).toHaveCount(1);
  await dismiss();
  await expect(page.locator(".edge:enabled").first()).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("an open game dialog defers the invite's install offer until it closes", async ({ page }) => {
  await withoutNativeInstall(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "getInstalledRelatedApps", {
      value: () => new Promise(resolve =>
        window.addEventListener("finish-install-check", () => resolve([]), { once: true })),
    });
    document.addEventListener("DOMContentLoaded", () =>
      document.querySelector<HTMLButtonElement>(".help-button")?.click(), { once: true });
  });
  await page.goto("./#room=ABC234");
  const help = page.getByRole("dialog", { name: "How to play" });
  await expect(help).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("finish-install-check")));
  await expect(installDialog(page)).toBeHidden();
  await help.getByRole("button", { name: "Got it" }).click();
  await installDialog(page).getByRole("button", { name: "Not now" }).click();
  await expect(page.getByLabel("Room code")).toHaveValue("ABC234");
  await page.getByRole("radio", { name: "Host a game" }).check();
  await page.getByRole("radio", { name: "Join a friend" }).check();
  await expect(installDialog(page)).toBeHidden();
  await expect(page.getByLabel("Room code")).toHaveValue("ABC234");
});

test("a native prompt can be canceled and retried using the same dialog", async ({ page }) => {
  await withoutNativeInstall(page);
  await page.goto("./#from=games-dashboard");
  const dialog = installDialog(page);
  await expect(dialog).toBeVisible();
  for (const outcome of ["dismissed", "accepted"]) {
    await page.evaluate(outcome => window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => { document.documentElement.dataset.gesture = String(navigator.userActivation.isActive); },
      userChoice: Promise.resolve({ outcome }),
    })), outcome);
    await expect(dialog.getByText("Copy the game link", { exact: true })).toBeHidden();
    await expect(dialog.locator("#install-manually")).toBeHidden();
    if (outcome === "dismissed") {
      await dialog.getByRole("button", { name: "Not now" }).click();
      await installIcon(page).click();
      await expect(dialog.locator("#install-manually")).toBeHidden();
    }
    const install = dialog.getByRole("button", { name: "Install app", exact: true });
    const { width, height } = (await install.boundingBox())!;
    const dismiss = dialog.getByRole("button", { name: "Not now" });
    expect(await dismiss.boundingBox()).toMatchObject({ width, height });
    await install.click();
    await expect(page.locator("html")).toHaveAttribute("data-gesture", "true");
    if (outcome === "dismissed") await expect(dialog.getByText("Installation canceled. You can keep playing here.", { exact: true })).toBeVisible();
  }
  await expect(dialog).toBeHidden();
  await expect(installIcon(page)).toBeHidden();
});

test("native installation stays compact while pending and shows manual help after a restriction", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
    Object.defineProperty(navigator, "install", {
      value: () => new Promise((_, reject) => window.addEventListener("restrict-install", () =>
        reject(new DOMException("Installation is restricted", "NotAllowedError")), { once: true })),
    });
  });
  for (const path of ["./", "./#from=games-dashboard"]) {
    await page.goto(path);
    const dialog = installDialog(page);
    const manual = dialog.locator("#install-manually");
    await dialog.getByRole("button", { name: "Install app", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Installing…" })).toBeVisible();
    await expect(manual).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new Event("restrict-install")));
    await expect(manual).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Install app", exact: true })).toBeHidden();
    if (path === "./") await dialog.getByText("Copy the game link", { exact: true }).click();
    await expect(dialog.getByLabel("Game link")).toHaveValue(gameURL);
    await expect(dialog.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(dialog).toBeHidden();
    await page.goto("about:blank");
  }
});

test("a home-screen launch and a browser-confirmed Boxes install suppress both install controls", async ({ page }) => {
  await withoutNativeInstall(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
    Object.defineProperty(navigator, "getInstalledRelatedApps", { value: async () =>
      location.hash || history.state?.boxGameDashboard ? [{
        platform: "webapp", url: document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href,
      }] : [] });
  });
  for (const path of ["./", "./#from=games-dashboard"]) {
    await page.goto(path);
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.locator(".edge:enabled").first()).toBeVisible();
    await expect(installIcon(page)).toBeHidden();
    await expect(installDialog(page)).toBeHidden();
    await page.evaluate(() => localStorage.removeItem("box-game.match"));
    await page.goto("about:blank");
  }
  const manifest = await (await page.request.get("./manifest.webmanifest")).json();
  expect(manifest.icons.find((entry: { sizes: string }) => entry.sizes === "192x192").src).toContain("board-192.png");
});

for (const [platform, userAgent, normal, embedded, next] of [
  ["Android", "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
    "Open Boxes in Chrome.", "Choose Open in Chrome in this window’s menu, or copy the game link below and open it in Chrome.",
    "Tap Chrome’s ⋮ menu, choose Install app or Add to Home screen, and follow the prompt."],
  ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    "Open Boxes in Safari and tap Share.", "Use Open in Safari in this window’s menu, or copy the game link below and open it in Safari. Tap Share.",
    "Choose Add to Home Screen. Turn on Open as Web App if offered, then tap Add."],
]) {
  test.describe(platform, () => {
    test.use({ userAgent });
    test("shows the shared wording in a browser and in the dashboard, even with a stalled app lookup", async ({ page }) => {
      await withoutNativeInstall(page);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { value: location.hash.includes("from=games-dashboard") });
        Object.defineProperty(navigator, "getInstalledRelatedApps", { value: () => new Promise(() => {}) });
        Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => {
          if (sessionStorage.getItem("copied")) throw new DOMException("Denied", "NotAllowedError");
          sessionStorage.setItem("copied", text);
        } } });
        sessionStorage.removeItem("copied");
        localStorage.setItem("box-game.installed", "1");
        sessionStorage.setItem("box-game.install-popup-shown", "1");
      });
      for (const [path, first] of [["./", normal], ["./#from=games-dashboard", embedded]]) {
        await page.goto(path);
        const dialog = installDialog(page);
        await expect(dialog.getByText(description, { exact: true })).toBeVisible();
        await expect(dialog.getByRole("listitem")).toHaveText([first, next]);
        const details = dialog.locator("details");
        await expect(details).toHaveJSProperty("open", first === embedded);
        if (first === normal) await details.getByText("Copy the game link", { exact: true }).click();
        const field = dialog.getByLabel("Game link");
        const copy = dialog.getByRole("button", { name: "Copy link", exact: true });
        const dismiss = dialog.getByRole("button", { name: "Not now" });
        await expect(field).toHaveValue(gameURL);
        const linkBox = (await field.boundingBox())!;
        const copyBox = (await copy.boundingBox())!;
        const dismissBox = (await dismiss.boundingBox())!;
        expect(copyBox.y).toBe(linkBox.y);
        expect(copyBox.x).toBeGreaterThan(linkBox.x + linkBox.width);
        expect(dismissBox.y).toBeGreaterThan(copyBox.y + copyBox.height);
        expect(dismissBox.height).toBe(copyBox.height);
        expect(dismissBox.x).toBe(linkBox.x);
        expect(dismissBox.x + dismissBox.width).toBe(copyBox.x + copyBox.width);
        await copy.click();
        await expect(dialog.getByText("Link copied.", { exact: true })).toBeVisible();
        expect(await page.evaluate(() => sessionStorage.getItem("copied"))).toBe(gameURL);
        await copy.click();
        await expect(dialog.getByText("Use your device’s Copy command to copy the selected link.", { exact: true })).toBeVisible();
        expect(await dialog.getByLabel("Game link").evaluate((input: HTMLInputElement) =>
          input.value.slice(input.selectionStart!, input.selectionEnd!))).toBe(gameURL);
        await dismiss.click();
        await expect(installIcon(page)).toBeInViewport();
        await page.goto("about:blank");
      }
      await page.goto("./#from=games-dashboard&room=ABC234");
      await expect(installDialog(page)).toBeVisible();
      await expect(page.locator("#code")).toHaveValue("ABC234");
      await installDialog(page).getByRole("button", { name: "Not now" }).click();
      await expect(page.getByRole("radio", { name: "Join a friend" })).toBeChecked();
      await expect(page.getByLabel("Room code")).toHaveValue("ABC234");
    });
  });
}
