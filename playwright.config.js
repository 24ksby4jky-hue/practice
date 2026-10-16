import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:4185";
export default defineConfig({
  testDir: "./e2e", workers: 1, timeout: 30000,
  reporter: "list",
  use: { baseURL, viewport: { width: 1280, height: 960 }, headless: true,
    channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
    screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 4185 --strictPort",
    url: baseURL, reuseExistingServer: !process.env.CI, timeout: 30000
  }
});
