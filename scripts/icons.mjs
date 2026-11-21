import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const output = new URL("../public/icons/", import.meta.url);
const browser = await chromium.launch();
try {
  await mkdir(output, { recursive: true });
  const page = await browser.newPage();
  for (const [name, size] of [
    ["board-192", 192],
    ["board-512", 512],
    ["board-maskable-512", 512],
    ["board-apple-touch", 180],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.goto(new URL("../public/icon.svg", import.meta.url).href);
    await page.evaluate((name) => {
      const maskable = name === "board-maskable-512";
      // These launchers apply their own corner masks to an opaque background.
      if (maskable || name === "board-apple-touch") {
        document.getElementById("background").setAttribute("rx", "0");
      }
      if (maskable) {
        document.getElementById("board").setAttribute(
          "transform", "translate(64 64) scale(.9) translate(-64 -64)",
        );
      }
    }, name);
    await page.screenshot({
      path: fileURLToPath(new URL(name + ".png", output)),
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
