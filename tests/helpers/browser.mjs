import { chromium } from "playwright";
import { existsSync } from "node:fs";

// CI uses the Playwright-pinned Chromium; developers may opt into installed Chrome.
export const launchBrowser = () =>
  chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  });
export const poppler = (name) =>
  process.env.POPPLER_BIN
    ? `${process.env.POPPLER_BIN}/${name}`
    : existsSync(`/opt/homebrew/opt/poppler/bin/${name}`)
      ? `/opt/homebrew/opt/poppler/bin/${name}`
      : name;
