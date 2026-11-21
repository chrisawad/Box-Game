import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const svg = await readFile(
  new URL("../public/icon.svg", import.meta.url),
  "utf8",
);
const browser = await chromium.launch();
try {
  await mkdir("public/icons", { recursive: true });
  const page = await browser.newPage();
  for (const [name, size] of [
    ["icon-192", 192],
    ["icon-512", 512],
    ["maskable-512", 512],
    ["apple-touch-icon", 180],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      "<style>*{box-sizing:border-box}body{margin:0;background:#6650c6;display:grid;place-items:center;height:100vh}svg{width:" +
        (name === "maskable-512" ? "84%" : "100%") +
        "}</style>" +
        svg,
    );
    await page.screenshot({ path: "public/icons/" + name + ".png" });
  }
} finally {
  await browser.close();
}
