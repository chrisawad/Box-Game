import { defineConfig } from "@playwright/test";
const base = process.env.BASE_PATH || "/";
const local = "http://127.0.0.1:4178" + base;
const isolated = !!process.env.PEER_CI;
const preview = {
  command:
    "pnpm preview --port 4178 --strictPort" +
    (isolated ? " --outDir .qa/peer-ci" : ""),
  url: local,
  reuseExistingServer: false,
};
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.e2e.ts",
  timeout: 75000,
  workers: 1,
  expect: { timeout: 9000 },
  use: {
    baseURL: process.env.PLAY_URL || local,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1366, height: 864 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.PLAY_URL
    ? undefined
    : isolated
      ? [
          {
            command: "pnpm exec peerjs --port 9108 --host 127.0.0.1",
            url: "http://127.0.0.1:9108/",
            reuseExistingServer: false,
          },
          preview,
        ]
      : preview,
});
