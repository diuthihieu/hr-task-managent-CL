import test from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, isIosOtherBrowser } from "../mobile-platform";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

test("iPhone, iPad (desktop-style user agent with touch), Android and computers are told apart", () => {
  assert.equal(detectPlatform(IPHONE), "ios");
  assert.equal(detectPlatform(IPAD_DESKTOP_UA, 5), "ios");
  assert.equal(detectPlatform(IPAD_DESKTOP_UA, 0), "other", "a Mac without touch is a computer");
  assert.equal(detectPlatform(ANDROID), "android");
  assert.equal(detectPlatform(WINDOWS), "other");
});

test("iOS in-app / non-Safari browsers are recognised (they need the 'open in Safari' hint)", () => {
  assert.equal(isIosOtherBrowser(IPHONE), false);
  assert.equal(isIosOtherBrowser(IPHONE.replace("Version/18.1", "CriOS/141.0")), true);
  assert.equal(isIosOtherBrowser(`${IPHONE} Zalo/24.10`), true);
});
