import { expect, test } from "@playwright/test";

const live = process.env.LIVE_TURN_TEST === "1";
test.use({ trace: "off" });
test("two browsers exchange moves over the selected direct or backup route", async ({ page, playwright, baseURL }, info) => {
  test.skip(info.project.name !== "desktop" || (!live && !process.env.PEER_CI), "Requires a room service.");
  test.setTimeout(100_000);
  const browser = await playwright.chromium.launch();
  try {
    const guest = await browser.newPage({ baseURL });
    let credentialRequests = 0;
    if (live) {
      await guest.addInitScript(() => {
        let interrupt = true;
        window.RTCPeerConnection = class extends RTCPeerConnection {
          override async setRemoteDescription(description: RTCSessionDescriptionInit) {
            await super.setRemoteDescription(description);
            if (interrupt && description.type === "answer") {
              interrupt = false;
              Object.defineProperty(this, "iceConnectionState", { value: "failed" });
              this.dispatchEvent(new Event("iceconnectionstatechange"));
            }
          }
        };
      });
    } else {
      for (const device of [page, guest]) {
        await device.route("**/test-turn-credentials", route => {
          expect(route.request().method()).toBe("POST");
          credentialRequests++;
          return route.fulfill({ status: 503, body: "" });
        });
      }
    }
    await page.goto("./");
    await page.getByRole("button", { name: "Not now" }).click();
    await page.getByRole("button", { name: "Online", exact: true }).click();
    await page.getByRole("button", { name: "Create private room" }).click();
    const code = await page.locator(".room-code").innerText({ timeout: 25000 });
    await guest.goto("./?room=" + code);
    await guest.getByRole("button", { name: "Not now" }).click();
    await guest.getByRole("button", { name: "Join room" }).click();
    if (live) await expect(guest.locator("#room-feedback")).toContainText("Retrying through the backup relay", { timeout: 32000 });
    for (const device of [page, guest])
      await expect(device.locator(".connection-route")).toHaveText(live ? "Via relay" : "Direct", { timeout: 45000 });
    if (!live) expect(credentialRequests).toBe(2);
    await page.locator(".edge:enabled").first().click();
    await expect(guest.locator(".edge.owned")).toHaveCount(1);
    await guest.locator(".edge:enabled").first().click();
    await expect(page.locator(".edge.owned")).toHaveCount(2);
  } finally {
    await browser.close();
  }
});
