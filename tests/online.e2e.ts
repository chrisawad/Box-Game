import { expect, test, type Page } from "@playwright/test";
import { useLocalIce } from "./local-ice";
import { createRequire } from "node:module";
import type jsQR from "jsqr";
const qrDecoder = createRequire(import.meta.url).resolve("jsqr");

test("an invite opens the dark join screen with the room filled in after dismissing the install dialog", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("./?room=abc234");
  await page.getByRole("button", { name: "Not now" }).click();
  const join = page.getByRole("radio", { name: "Join a friend" });
  const code = page.getByRole("textbox", { name: "Room code" });
  await expect(join).toBeChecked();
  await expect(code).toHaveValue("ABC234");
  // Wait for installation detection, then also exercise a late eligibility event.
  await expect(page.locator("header #install")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Board size" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Join room" })).toBeInViewport();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  const teal = page.getByRole("radio", { name: "Teal", exact: true });
  await teal.check();
  await page.getByLabel("Your initials").fill("AX");

  await page.getByRole("radio", { name: "Host a game" }).check();
  await expect(page.getByRole("button", { name: "Create private room" })).toBeVisible();
  await expect(code).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Board size" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find public game" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Public match" }).check();
  await expect(page.getByRole("button", { name: "Find public game" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create private room" })).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(join).toBeFocused();
  await expect(code).toHaveValue("ABC234");
  await expect(teal).toBeChecked();
  await expect(page.getByLabel("Your initials")).toHaveValue("AX");
  await page.reload();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(teal).toBeChecked();
  await expect(page.locator("header #install")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto("./");
  await expect(page.getByRole("dialog", { name: "Install Boxes" })).toBeVisible();
});

async function configure(p: Page, tag: string, option = "Host a game") {
  await p.goto("./");
  await p.getByRole("button", { name: "Not now" }).click();
  await p.getByRole("button", { name: "Online", exact: true }).click();
  await p.getByRole("radio", { name: option }).check();
  await p.getByLabel("Your initials").fill(tag);
}
test("a fragment invite opens Join in an already open game", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.evaluate(() => { location.hash = "room=abc234"; });
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("radio", { name: "Join a friend" })).toBeChecked();
  await expect(page.getByLabel("Room code")).toHaveValue("ABC234");
  await expect(page.getByRole("dialog")).toBeHidden();
});
test("an installed waiting room keeps its invite and has one host window", async ({ context, page }, info) => {
  test.skip(!process.env.PEER_CI || info.project.name !== "desktop", "Requires isolated signaling.");
  await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  await page.goto("./");
  await page.getByRole("button", { name: "Online", exact: true }).click();
  await page.getByRole("button", { name: "Create private room" }).click();
  const code = await page.locator(".room-code").innerText();
  const reopened = await context.newPage();
  await reopened.goto("./");
  await expect(reopened.locator("#room-feedback")).toContainText("open in another game window");
  await expect(page.locator(".room-code")).toHaveText(code);
  await page.close();
  await reopened.reload();
  await expect(reopened.locator(".room-code")).toHaveText(code);
  await reopened.getByRole("button", { name: "Leave room" }).click();
  await expect(reopened.locator(".room-code")).toHaveCount(0);
  expect(await reopened.evaluate(() => localStorage.getItem("box-game.waiting-host.v1"))).toBeNull();
});
test("an offline guest gets recovery advice at the Join button", async ({ page, context }) => {
  await page.goto("./?room=ABC234");
  await page.getByRole("button", { name: "Not now" }).click();
  const join = page.getByRole("button", { name: "Join room" });
  const code = page.getByLabel("Room code");
  await code.fill("A0I");
  await join.click();
  await expect(page.locator("#room-feedback")).toContainText("six-character room code from your friend");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await code.fill("ABC234");
  await expect(page.locator("#room-feedback")).toBeEmpty();
  await context.setOffline(true);
  await join.click();
  await expect(page.locator("#room-feedback")).toContainText("You’re offline. Connect to Wi-Fi or mobile data");
  await expect(page.getByLabel("Room code")).toHaveValue("ABC234");
  await expect(join).toBeEnabled();
});

test("a missing room and an unreachable service give different next steps", async ({ page }, info) => {
  test.skip(!process.env.PEER_CI || info.project.name !== "desktop", "Requires isolated signaling.");
  await page.goto("./?room=ZZZ999");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Join room" }).click();
  const feedback = page.locator("#room-feedback");
  await expect(feedback).toContainText("Room not found. Check the code", { timeout: 20000 });
  await page.getByRole("radio", { name: "Host a game" }).check();
  await expect(feedback).toBeEmpty();
  await page.routeWebSocket(/:9108\//, socket => {
    socket.close({ code: 1011, reason: "Test service unavailable" });
  });
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(feedback).toContainText(/room service.*(internet connection|try again)/i, { timeout: 22000 });
  await expect(feedback).not.toContainText(/peerjs|socket|chrisawad-box/i);
});

test("QR and link pair two peers, enforce seats, reconnect, finish and rematch", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !(process.env.ONLINE_SMOKE || process.env.PEER_CI) ||
      info.project.name !== "desktop",
    "Run this with a signaling server.",
  );
  test.setTimeout(180000);
  const host = await browser.newContext({ baseURL, permissions: ["clipboard-read", "clipboard-write"] });
  await host.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => { sessionStorage.setItem("test-share", JSON.stringify(data)); },
    });
  });
  const guest = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const x = await host.newPage(),
    y = await guest.newPage();
  try {
    await configure(x, "AX");
    for (const name of ["Fewer columns", "Fewer rows"])
      for (let i = 0; i < 2; i++) await x.getByRole("button", { name }).click();
    await x.getByRole("button", { name: "Create private room" }).click();
    await expect(x.locator(".room-code"), "Private room creation").toBeVisible({
      timeout: 25000,
    });
    const code = await x.locator(".room-code").innerText();
    await expect(x.getByRole("button", { name: /copy.*code/i })).toHaveCount(0);
    const img = x.getByRole("img", { name: "QR code for room " + code });
    await expect(img).toBeVisible();
    await x.getByRole("button", { name: "Share", exact: true }).click();
    const gameShare = await x.evaluate(() => JSON.parse(sessionStorage.getItem("test-share")!));
    expect(gameShare.url).toBe("https://boxes.chrisawad.com/");
    expect(gameShare.text).not.toContain(code);
    await x.getByRole("button", { name: "Share invite", exact: true }).click();
    const { url: invite, text } = await x.evaluate(() => JSON.parse(sessionStorage.getItem("test-share")!));
    expect(text).toContain(code);
    expect(invite).toBe(`https://boxes.chrisawad.com/#room=${code}`);
    await x.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(x.locator("#invite-feedback")).toHaveText("Invite link copied.");
    expect(await x.evaluate(() => navigator.clipboard.readText())).toBe(invite);
    await x.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined }));
    await x.getByRole("button", { name: "Share invite", exact: true }).click();
    const fallback = x.getByRole("dialog", { name: "Share invite" });
    await expect(fallback.getByLabel("Send this link to a friend")).toHaveValue(invite);
    const email = await fallback.getByRole("link", { name: "Share by email" }).getAttribute("href");
    expect(new URL(email!).searchParams.get("body")).toContain(invite);
    await fallback.getByRole("button", { name: "Close" }).click();
    await x.addScriptTag({ path: qrDecoder });
    const decoded = await img.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d")!;
      const decoder = (window as unknown as { jsQR: typeof jsQR }).jsQR;
      return decoder(
        ctx.getImageData(0, 0, c.width, c.height).data,
        c.width,
        c.height,
      )?.data;
    });
    expect(decoded).toBe(invite);
    if (process.env.PEER_CI) {
      // Mirror the public redirect while keeping the test's room on local signaling.
      await guest.route("https://boxes.chrisawad.com/**", route =>
        route.fulfill({ status: 301, headers: { location: baseURL! } }));
    }
    await y.goto(decoded!);
    await expect(y.getByRole("dialog", { name: "Install Boxes" })).toBeVisible();
    await expect(y.locator("#code")).toHaveValue(code);
    await y.getByRole("button", { name: "Not now" }).click();
    await expect(y.getByRole("radio", { name: "Join a friend" })).toBeChecked();
    await expect(y.getByRole("dialog")).toBeHidden();
    await expect(y.getByLabel("Room code")).toHaveValue(code);
    await y.getByLabel("Your initials").fill("BY");
    await y.getByRole("button", { name: "Join room", exact: true }).click();
    for (const p of [y, x])
      await expect(p.locator(".transport")).toHaveText("Connected to opponent", {
        timeout: 25000,
      });
    expect(new URL(y.url()).hash).toBe("");
    await expect(y.locator(".match-meta .kicker")).toContainText(code);
    const leave = y.getByRole("button", { name: "Leave room" });
    for (const [width, height] of [[390, 844], [568, 320], [844, 390]]) {
      await y.setViewportSize({ width, height });
      await expect(y.locator(".room-connection")).toBeInViewport({ ratio: 1 });
      await expect(leave).toBeInViewport({ ratio: 1 });
      expect((await leave.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (width > height) await expect(y.locator(".progress-row")).toBeInViewport({ ratio: 1 });
    }
    await leave.tap();
    await y.getByRole("button", { name: "Keep playing" }).tap();
    await expect(y.locator(".edge:enabled")).toHaveCount(0);
    await x.locator(".edge:enabled").first().click();
    await expect(y.locator(".edge.owned")).toHaveCount(1);
    await y.reload();
    await y.getByRole("button", { name: "Not now" }).click();
    await expect(y.locator(".edge:enabled")).toHaveCount(11, {
      timeout: 30000,
    });
    await expect(y.getByRole("dialog")).toBeHidden();
    await y.locator(".edge:enabled").first().click();
    await expect(x.locator(".edge.owned")).toHaveCount(2);
    await x.reload();
    await x.getByRole("button", { name: "Not now" }).click();
    await expect(x.locator(".edge:enabled")).toHaveCount(10, {
      timeout: 45000,
    });
    for (let i = 2; i < 12; i++) {
      const turn = (await x.locator(".turn").innerText()).startsWith("AX")
        ? x
        : y;
      await turn.locator(".edge:enabled").first().click();
      for (const p of [x, y])
        await expect(p.locator(".edge.owned")).toHaveCount(i + 1);
    }
    for (const p of [x, y]) {
      await expect(p.getByRole("dialog")).toBeVisible();
      await p.getByRole("button", { name: "View board" }).click();
    }
    await y.getByRole("button", { name: "Play again" }).click();
    await expect(y.getByText("Waiting for your opponent to play again.")).toBeVisible();
    await expect(x.getByText("Your opponent wants to play again.")).toBeVisible();
    await expect(x.locator(".edge.owned")).toHaveCount(12);
    await x.getByRole("button", { name: "Play again" }).click();
    for (const p of [x, y])
      await expect(p.locator(".edge.owned")).toHaveCount(0);
    await x.getByRole("button", { name: "Leave room" }).click();
    await x
      .getByRole("dialog")
      .getByRole("button", { name: "Leave room" })
      .click();
    await expect(y.locator(".turn")).toHaveText("Opponent left");
  } finally {
    await host.close();
    await guest.close();
  }
});
test("public search pairs two simultaneous requests on the same board size", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !process.env.PEER_CI || info.project.name !== "desktop",
    "Use the isolated local public queue.",
  );
  test.setTimeout(60000);
  const a = await browser.newContext({ baseURL }),
    b = await browser.newContext({ baseURL });
  const x = await a.newPage(),
    y = await b.newPage();
  try {
    await Promise.all([x.addInitScript(useLocalIce), y.addInitScript(useLocalIce)]);
    await Promise.all([configure(x, "FOX", "Public match"), configure(y, "OWL", "Public match")]);
    await Promise.all(
      [x, y].map((p) =>
        p.getByRole("button", { name: "Find public game" }).click(),
      ),
    );
    // Discovery and joining use separate WebRTC connections. Report both players'
    // actual lobby or error messages while waiting for the second handshake.
    await expect.poll(async () => Promise.all([x, y].map(async p => {
      const status = await p.locator(".transport, #room-feedback, .waiting [role=status]").allTextContents();
      return status.join(" ").trim();
    })), { timeout: 45000 }).toEqual(["Connected to opponent", "Connected to opponent"]);
    for (const p of [x, y]) await expect(p.locator(".score")).toHaveCount(2);
    const leader = (await x.locator(".edge:enabled").count()) ? x : y;
    await leader.locator(".edge:enabled").first().click();
    for (const p of [x, y])
      await expect(p.locator(".edge.owned")).toHaveCount(1);
  } finally {
    await a.close();
    await b.close();
  }
});
test("pair code connects the guest and a third player cannot take the seat", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !process.env.PEER_CI || info.project.name !== "desktop",
    "Use isolated signaling.",
  );
  test.setTimeout(60000);
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ baseURL })),
  );
  const [x, y, z] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    await Promise.all([
      configure(x, "A"),
      configure(y, "B", "Join a friend"),
      configure(z, "C", "Join a friend"),
    ]);
    await x.getByRole("button", { name: "Create private room" }).click();
    const code = await x.locator(".room-code").innerText();
    for (const p of [y, z]) {
      await p.getByLabel("Room code").fill(code);
      await p.getByRole("button", { name: "Join room", exact: true }).click();
      if (p === y)
        await expect(y.locator(".transport")).toHaveText("Connected to opponent", {
          timeout: 20000,
        });
    }
    await expect(z.locator("#room-feedback")).toContainText(
      "This room already has two players. Ask your friend to create a new room",
      { timeout: 20000 },
    );
    await expect(x.locator(".score b").last()).toHaveText("B");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
