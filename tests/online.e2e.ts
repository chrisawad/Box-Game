import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import type jsQR from "jsqr";
const qrDecoder = createRequire(import.meta.url).resolve("jsqr");

async function configure(p: Page, tag: string) {
  await p.goto("./");
  await p.getByRole("button", { name: "Maybe later" }).click();
  await p.getByRole("button", { name: "Online", exact: true }).click();
  await p.getByLabel("Your initials").fill(tag);
}
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
  const host = await browser.newContext({
    baseURL,
    permissions: ["clipboard-read", "clipboard-write"],
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
    await x.getByRole("button", { name: "Copy invite link" }).click();
    const invite = await x.evaluate(() => navigator.clipboard.readText());
    expect(new URL(invite).searchParams.get("room")).toBe(code);
    expect(new URL(invite).origin).toBe(new URL(baseURL!).origin);
    await x.getByRole("button", { name: "Show QR code" }).click();
    const img = x.getByRole("img", { name: "QR code for room " + code });
    await x.addScriptTag({ path: qrDecoder });
    const decoded = await img.evaluate(async (element: HTMLImageElement) => {
      await element.decode();
      const c = document.createElement("canvas");
      c.width = element.naturalWidth;
      c.height = element.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(element, 0, 0);
      const decoder = (window as unknown as { jsQR: typeof jsQR }).jsQR;
      return decoder(
        ctx.getImageData(0, 0, c.width, c.height).data,
        c.width,
        c.height,
      )?.data;
    });
    expect(decoded).toBe(invite);
    await x.getByRole("button", { name: "Close", exact: true }).click();
    await y.goto(invite);
    await y.getByRole("button", { name: "Maybe later" }).click();
    await expect(y.getByLabel("Room code")).toHaveValue(code);
    await y.getByLabel("Your initials").fill("BY");
    await y.getByRole("button", { name: "Join", exact: true }).click();
    for (const p of [y, x])
      await expect(p.locator(".transport")).toHaveText("PeerJS · WebRTC", {
        timeout: 25000,
      });
    await expect(y.locator(".edge:enabled")).toHaveCount(0);
    await x.locator(".edge:enabled").first().click();
    await expect(y.locator(".edge.owned")).toHaveCount(1);
    await y.reload();
    await expect(y.locator(".edge:enabled")).toHaveCount(11, {
      timeout: 30000,
    });
    await y.locator(".edge:enabled").first().click();
    await expect(x.locator(".edge.owned")).toHaveCount(2);
    await x.reload();
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
    const starter = (await x
      .getByRole("button", { name: "Play again" })
      .count())
      ? x
      : y;
    await starter.getByRole("button", { name: "Play again" }).click();
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
    await Promise.all([configure(x, "FOX"), configure(y, "OWL")]);
    await Promise.all(
      [x, y].map((p) =>
        p.getByRole("button", { name: "Find public game" }).click(),
      ),
    );
    for (const p of [x, y]) {
      await expect(p.locator(".transport")).toContainText("WebRTC", {
        timeout: 25000,
      });
      await expect(p.locator(".score")).toHaveCount(2);
    }
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
      configure(y, "B"),
      configure(z, "C"),
    ]);
    await x.getByRole("button", { name: "Create private room" }).click();
    const code = await x.locator(".room-code").innerText();
    for (const p of [y, z]) {
      await p.getByLabel("Room code").fill(code);
      await p.getByRole("button", { name: "Join", exact: true }).click();
      if (p === y)
        await expect(y.locator(".transport")).toContainText("WebRTC", {
          timeout: 20000,
        });
    }
    await expect(z.locator("#notice")).toContainText(
      "already has two players",
      { timeout: 20000 },
    );
    await expect(x.locator(".score b").last()).toHaveText("B");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
