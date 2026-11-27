import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const live = process.env.LIVE_TURN_TEST === "1";
test.use({ trace: "off" });

async function forceFirstDirectFailure(page: Page) {
  await page.addInitScript(() => {
    let interrupt = true;
    const apply = RTCPeerConnection.prototype.setRemoteDescription;
    RTCPeerConnection.prototype.setRemoteDescription = async function (description) {
      await apply.call(this, description);
      if (interrupt && description?.type === "answer") {
        interrupt = false;
        Object.defineProperty(this, "iceConnectionState", { value: "failed" });
        this.dispatchEvent(new Event("iceconnectionstatechange"));
      }
    };
  });
}

// The broker is mocked only in the isolated suite. ICE still connects two browser
// processes. Record the exact seat config, then use loopback in place of a paid relay.
async function observeMockRelay(page: Page) {
  await page.addInitScript(() => {
    function local(config?: RTCConfiguration) {
      if (config?.iceTransportPolicy !== "relay") return config;
      document.documentElement.dataset.relaySeat = config.iceServers?.find(s => s.username)?.username;
      return { ...config, iceServers: [], iceTransportPolicy: "all" as const };
    }
    window.RTCPeerConnection = class extends RTCPeerConnection {
      constructor(config?: RTCConfiguration) { super(local(config)); }
      override setConfiguration(config?: RTCConfiguration) { super.setConfiguration(local(config)); }
    };
  });
}

for (const scenario of ["direct", "private relay", "public queue relay", "restored seat relay"]) {
  const relay = scenario !== "direct";
  test("two browsers exchange moves using " + scenario, async ({ page, playwright, baseURL }, info) => {
    test.skip(info.project.name !== "desktop" || (!live && !process.env.PEER_CI), "Requires a room service.");
    test.skip(live && (scenario === "public queue relay" || scenario === "restored seat relay"), "Use isolated queues and seats.");
    test.setTimeout(100_000);
    const browser = await playwright.chromium.launch();
    try {
      const guest = await browser.newPage({ baseURL });
      let commitment = "", joined = false;
      const minted: string[] = [];
      const requests: string[] = [];
      if (relay && scenario !== "restored seat relay") await forceFirstDirectFailure(guest);
      if (!live) for (const [device, seat] of [[page, "host"], [guest, "guest"]] as const) {
        await observeMockRelay(device);
        await device.route(/\/test-turn-credentials(?:\/|$)/, async route => {
          const path = new URL(route.request().url()).pathname.split("/").pop()!;
          requests.push(path);
          const body = route.request().postDataJSON();
          const ok = (json: object) => route.fulfill({ json });
          if (path === "matches" && seat === "host" && body.game === "box-game-v1" && body.hostPeer !== body.guestPeer) {
            commitment = body.guestCommitment;
            return ok({ match: "test-match", session: "host-session" });
          }
          if (body.match === "test-match") {
            if (path === "join" && seat === "guest" && createHash("sha256").update(body.secret).digest("hex") === commitment) {
              joined = true;
              return ok({ session: "guest-session" });
            }
            if (body.session === seat + "-session") {
              if (path === "ticket") return joined ? ok({ ticket: seat + "-ticket" }) : route.fulfill({ status: 409 });
              if (path === "credentials" && joined && body.ticket === seat + "-ticket" && !minted.includes(seat)) {
                minted.push(seat);
                return ok({ iceServers: [{ urls: "turn:localhost:3478", username: seat, credential: "test-only" }] });
              }
            }
          }
          return route.fulfill({ status: 403 });
        });
      }
      await page.goto("./");
      await page.getByRole("button", { name: "Not now" }).click();
      await page.getByRole("button", { name: "Online", exact: true }).click();
      const isPublic = scenario === "public queue relay";
      if (isPublic) await page.getByRole("radio", { name: "Public match" }).check();
      await page.getByRole("button", { name: isPublic ? "Find public game" : "Create private room" }).click();
      const code = await page.locator(".room-code").innerText({ timeout: 25000 });
      expect(requests).toHaveLength(0);
      await guest.goto(isPublic ? "./" : "./#room=" + code);
      await guest.getByRole("button", { name: "Not now" }).click();
      if (isPublic) {
        await guest.getByRole("button", { name: "Online", exact: true }).click();
        await guest.getByRole("radio", { name: "Public match" }).check();
      }
      await guest.getByRole("button", { name: isPublic ? "Find public game" : "Join room" }).click();
      if (scenario === "restored seat relay") {
        await expect(guest.locator(".transport")).toHaveText("Connected to opponent", { timeout: 30000 });
        expect(requests).toHaveLength(0);
        await forceFirstDirectFailure(guest);
        await guest.reload();
        await guest.getByRole("button", { name: "Not now" }).click();
      }
      for (const device of [page, guest])
        await expect(device.locator(".connection-route")).toHaveText(live && relay ? "Via relay" : "Direct", { timeout: 65000 });
      if (!live && relay) {
        await expect.poll(() => [...minted].sort(), { timeout: 30000 }).toEqual(["guest", "host"]);
        await expect(page.locator("html")).toHaveAttribute("data-relay-seat", "host");
        await expect(guest.locator("html")).toHaveAttribute("data-relay-seat", "guest");
      } else if (!live) expect(requests).toHaveLength(0);
      await page.locator(".edge:enabled").first().click();
      await expect(guest.locator(".edge.owned")).toHaveCount(1);
      await guest.locator(".edge:enabled").first().click();
      await expect(page.locator(".edge.owned")).toHaveCount(2);
    } finally { await browser.close(); }
  });
}
