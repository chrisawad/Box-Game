import { test, expect } from "@playwright/test";
test("local game, double scoring, reload and rematch", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Maybe later" }).click();
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByLabel("Player 1 initials").fill("AB");
  await page.getByLabel("Player 2 initials").fill("CD");
  const playerOne = page.getByRole("region", { name: "Player 1", exact: true });
  const playerTwo = page.getByRole("region", { name: "Player 2", exact: true });
  await playerOne.getByRole("radio", { name: "Orange", exact: true }).check();
  await expect(playerTwo.getByRole("radio", { name: "Purple", exact: true })).toBeChecked();
  await playerOne.getByRole("radio", { name: "Teal", exact: true }).check();
  await expect(playerOne.locator("legend")).toHaveText("Choose colorTeal");
  for (const key of ["columns", "rows"])
    await page
      .getByRole("button", { name: "Fewer " + key })
      .click({ clickCount: 1 })
      .then(() => page.getByRole("button", { name: "Fewer " + key }).click());
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator(".edge")).toHaveCount(12);
  const moves = ["h_0_0", "h_0_1", "h_1_0", "h_1_1", "v_0_0", "v_0_2", "v_0_1"];
  for (const k of moves) await page.locator('[data-edge="' + k + '"]').click();
  await expect(page.locator(".tile")).toHaveCount(2);
  await expect(page.locator(".score strong").first()).toHaveText("2");
  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(2);
  while (await page.locator(".edge:enabled").count())
    await page.locator(".edge:enabled").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".result-score")).toContainText("AB");
  await page.getByRole("button", { name: "View board" }).click();
  await expect(page.locator(".tile")).toHaveCount(4);
  await page.reload();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.locator(".edge:enabled")).toHaveCount(12);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("computer responds, local match resumes offline, and installation respects browser state", async ({
  page,
  context,
}) => {
  await page.goto("./");
  const offer = page.getByRole("dialog", { name: "Install Box Game" });
  await expect(offer).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "install", {
      configurable: true,
      value: async () => {
        document.documentElement.dataset.installRequested = "yes";
      },
    });
  });
  await offer.getByRole("button", { name: "Install game" }).click();
  await expect(offer).toBeHidden();
  await expect(page.getByRole("button", { name: "Install game" })).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute(
    "data-install-requested",
    "yes",
  );
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator(".edge:enabled").first().click();
  await expect(page.locator(".edge.owned")).toHaveCount(2);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".edge.owned")).toHaveCount(2);
  await page.locator(".edge:enabled").first().click();
  await expect(page.locator(".edge.owned")).toHaveCount(4);
});
test("install guidance, help and a rectangular game", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Maybe later" }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("fourth side");
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("button", { name: "More columns" }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator(".edge")).toHaveCount(49);
  await page.getByRole("button", { name: "New game" }).click();
  await page.getByRole("button", { name: "Keep playing" }).click();
  await expect(page.locator(".edge")).toHaveCount(49);
});
