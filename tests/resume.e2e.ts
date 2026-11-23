import { expect, test, type Page } from "@playwright/test";

test.use({ trace: "off" });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "mobile" || !(process.env.PEER_CI || process.env.ONLINE_SMOKE), "Two mobile browsers and a room service.");
});

async function startMatch(host: Page, guest: Page) {
  await host.goto("./");
  await host.getByRole("button", { name: "Maybe later" }).click();
  await host.getByRole("button", { name: "Online", exact: true }).click();
  await host.getByLabel("Your initials").fill("AX");
  await host.getByRole("button", { name: "Create private room" }).click();
  const code = await host.locator(".room-code").innerText({ timeout: 25000 });
  await guest.goto("./?room=" + code);
  await guest.getByLabel("Your initials").fill("BY");
  await guest.getByRole("button", { name: "Join room" }).click();
  await expect(guest.locator(".transport")).toHaveText("Connected to opponent", { timeout: 30000 });
  await host.locator(".edge:enabled").first().click();
  await expect(guest.locator(".edge.owned")).toHaveCount(1);
  return code;
}

test("both seats survive a fresh launch, an invite reopening and an offline return", async ({ page: host, context, browser, baseURL, viewport }) => {
  test.setTimeout(120000);
  const friend = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true });
  try {
    const guest = await friend.newPage();
    const code = await startMatch(host, guest);
    await guest.close();
    const returningGuest = await friend.newPage();
    await returningGuest.goto("./#room=" + code);
    await expect(returningGuest.locator(".edge.owned")).toHaveCount(1);
    await expect(returningGuest.locator(".score b").last()).toHaveText("BY");
    await returningGuest.locator(".edge:enabled").first().click();
    await expect(host.locator(".edge.owned")).toHaveCount(2);

    await host.evaluate(async () => { await navigator.serviceWorker.ready; });
    await host.close();
    await context.setOffline(true);
    const returningHost = await context.newPage();
    await returningHost.goto("./");
    await expect(returningHost.locator(".edge.owned")).toHaveCount(2);
    await expect(returningHost.locator(".edge:enabled")).toHaveCount(0);
    await expect(returningHost.locator(".turn")).toHaveText("Waiting to reconnect…");
    await expect(returningHost.getByRole("dialog")).toBeHidden();
    await context.setOffline(false);
    await expect(returningHost.locator(".transport")).toHaveText("Connected to opponent", { timeout: 35000 });
    await returningHost.locator(".edge:enabled").first().click();
    await expect(returningGuest.locator(".edge.owned")).toHaveCount(3);

    await returningHost.getByRole("button", { name: "Leave room" }).click();
    await returningHost.getByRole("dialog").getByRole("button", { name: "Leave room" }).click();
    await expect(returningGuest.locator(".turn")).toHaveText("Opponent left");
    await returningGuest.goto("./?room=" + code);
    await expect(returningGuest.getByRole("button", { name: "Join room" })).toBeVisible();
    await returningHost.reload();
    await expect(returningHost.locator(".edge")).toHaveCount(0);
  } finally { await friend.close(); }
});

test("freeze and resume preserve the host and a hidden guest can hand off its seat by code", async ({ page: host, browser, baseURL, viewport }) => {
  test.setTimeout(120000);
  const friend = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true });
  try {
    const guest = await friend.newPage();
    const code = await startMatch(host, guest);
    // Headless Chromium keeps automation targets visible. Deliver the same
    // document events Android sends while exercising real signaling and WebRTC.
    await host.evaluate(() => document.dispatchEvent(new Event("freeze")));
    await expect(guest.locator(".turn")).toHaveText("Waiting to reconnect…", { timeout: 12000 });
    await host.evaluate(() => document.dispatchEvent(new Event("resume")));
    await expect(guest.locator(".transport")).toHaveText("Connected to opponent", { timeout: 35000 });
    await expect(host.locator(".edge.owned")).toHaveCount(1);
    await guest.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const reopened = await friend.newPage();
    const otherCode = code === "ABC234" ? "ABC235" : "ABC234";
    await reopened.goto("./?room=" + otherCode);
    await expect(reopened.getByLabel("Room code")).toHaveValue(otherCode);
    await reopened.getByLabel("Room code").fill(code);
    await reopened.getByRole("button", { name: "Join room" }).click();
    await reopened.locator(".edge:enabled").first().click({ timeout: 35000 });
    await expect(host.locator(".edge.owned")).toHaveCount(2);
    await reopened.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await guest.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(guest.locator(".edge.owned")).toHaveCount(2, { timeout: 35000 });
    await expect(guest.locator(".transport")).toHaveText("Connected to opponent");
    await host.locator(".edge:enabled").first().click();
    await expect(guest.locator(".edge.owned")).toHaveCount(3);
  } finally { await friend.close(); }
});
