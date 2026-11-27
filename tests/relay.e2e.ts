import { createHash, randomUUID } from "node:crypto";
import { useLocalIce } from "./local-ice";
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

for (const scenario of ["direct", "private relay", "public queue relay", "restored seat relay", "canceled verification"]) {
  const relay = scenario !== "direct";
  test("two browsers exchange moves using " + scenario, async ({ page, playwright, baseURL }, info) => {
    test.skip(info.project.name !== "desktop" || (!live && !process.env.PEER_CI), "Requires a room service.");
    test.skip(live && (scenario === "public queue relay" || scenario === "restored seat relay" || scenario === "canceled verification"), "Use isolated queues and seats.");
    test.setTimeout(100_000);
    const browser = await playwright.chromium.launch();
    try {
      const guest = await browser.newPage({ baseURL });
      const matches = new Map<string, { commitment: string; joined: boolean; redeemed: Set<string> }>();
      const minted: string[] = [];
      const requests: string[] = [];
      if (relay && scenario !== "restored seat relay") await forceFirstDirectFailure(guest);
      if (!live) for (const [device, seat] of [[page, "host"], [guest, "guest"]] as const) {
        await device.addInitScript(useLocalIce);
        await device.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", route => route.fulfill({
          contentType: "text/javascript", body: `window.turnstile = {
            ready(run) { run(); },
            render(element, options) {
              if (options.sitekey !== 'fixture-sitekey' || options.action !== 'game_relay') throw Error('Unexpected widget');
              if (${scenario !== "canceled verification"}) queueMicrotask(() => options.callback(options.cData));
              return 'widget';
            },
            remove() {}
          }`,
        }));
        await device.route(/\/test-turn-credentials(?:\/|$)/, async route => {
          const path = new URL(route.request().url()).pathname.split("/").pop()!;
          requests.push(path);
          const body = route.request().postDataJSON();
          const ok = (json: object) => route.fulfill({ json });
          if (path === "matches" && seat === "host" && body.game === "box-game-v1" && body.hostPeer !== body.guestPeer) {
            const match = randomUUID();
            matches.set(match, { commitment: body.guestCommitment, joined: false, redeemed: new Set() });
            return ok({ match, session: match + "-host", sitekey: "fixture-sitekey" });
          }
          const match = matches.get(body.match);
          if (match) {
            if (path === "join" && seat === "guest" && createHash("sha256").update(body.secret).digest("hex") === match.commitment) {
              match.joined = true;
              return ok({ session: body.match + "-guest", sitekey: "fixture-sitekey" });
            }
            if (body.session === body.match + "-" + seat) {
              if (path === "ticket") return match.joined ? ok({ ticket: body.session + "-ticket" }) : route.fulfill({ status: 409 });
              if (path === "credentials" && match.joined && body.ticket === body.session + "-ticket" &&
                  body.turnstileToken === createHash("sha256").update(body.match + ":" + body.session).digest("hex") && !match.redeemed.has(seat)) {
                match.redeemed.add(seat);
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
      if (scenario === "canceled verification") {
        const verification = guest.getByRole("dialog", { name: "Verify to connect" });
        await expect(verification).toBeVisible({ timeout: 35000 });
        await verification.getByRole("button", { name: "Cancel" }).click();
        await expect(verification).toHaveCount(0);
        await expect(guest.locator("#room-feedback")).toContainText("backup relay");
        expect(requests).not.toContain("credentials");
        return;
      }
      if (scenario === "restored seat relay") {
        await expect(guest.locator(".transport")).toHaveText("Connected to opponent", { timeout: 30000 });
        expect(requests).toHaveLength(0);
        await forceFirstDirectFailure(guest);
        await guest.reload();
        await guest.getByRole("button", { name: "Not now" }).click();
      }
      const expectedRoute = live && relay ? "Via relay" : "Direct";
      await expect.poll(async () => ({
        routes: await Promise.all([page, guest].map(async p =>
          (await p.locator(".connection-route, #room-feedback, .waiting [role=status]").allTextContents()).join(" ").trim())),
        calls: requests.slice(-8),
      }), { timeout: 65000 }).toMatchObject({ routes: [expectedRoute, expectedRoute] });
      if (!live && relay) {
        await expect.poll(() => [...new Set(minted)].sort(), { timeout: 30000 }).toEqual(["guest", "host"]);
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
