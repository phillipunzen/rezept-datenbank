import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    // A non-localhost HTTP origin exercises the same browser APIs as the LAN instance.
    baseURL: "http://rezeptdatenbank.test:8081",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--no-proxy-server",
        "--host-resolver-rules=MAP rezeptdatenbank.test 127.0.0.1",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
