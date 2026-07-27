import assert from "node:assert/strict";
import test from "node:test";

import { loadRuntimeConfig, parseBoolean } from "./runtime-config.mjs";

test("parseBoolean accepts explicit true and false values", () => {
  assert.equal(parseBoolean("true", false), true);
  assert.equal(parseBoolean("1", false), true);
  assert.equal(parseBoolean("false", true), false);
  assert.equal(parseBoolean("0", true), false);
  assert.equal(parseBoolean(undefined, true), true);
});

test("loadRuntimeConfig defaults to local CDP mode", () => {
  const config = loadRuntimeConfig({});

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3210);
  assert.equal(config.browser.mode, "cdp");
  assert.equal(config.browser.cdpUrl, "http://127.0.0.1:9224");
});

test("managed mode requires a persistent profile directory", () => {
  assert.throws(
    () => loadRuntimeConfig({ PARSER_BROWSER_MODE: "managed" }),
    /PARSER_CHROME_PROFILE_DIR/,
  );
});

test("managed mode reads server browser settings", () => {
  const config = loadRuntimeConfig({
    PARSER_BROWSER_MODE: "managed",
    PARSER_CHROME_PROFILE_DIR: "/var/lib/taobao-parser/profile",
    PARSER_HEADLESS: "false",
    PARSER_HOST: "0.0.0.0",
    PARSER_PORT: "8080",
  });

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(config.browser.mode, "managed");
  assert.equal(
    config.browser.profileDir,
    "/var/lib/taobao-parser/profile",
  );
  assert.equal(config.browser.headless, false);
});
