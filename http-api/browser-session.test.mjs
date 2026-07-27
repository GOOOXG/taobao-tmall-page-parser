import assert from "node:assert/strict";
import test from "node:test";

import { hasAuthenticatedCookies } from "./browser-session.mjs";

test("anonymous Taobao cookies do not count as an authenticated account", () => {
  assert.equal(
    hasAuthenticatedCookies([
      { name: "cookie2", value: "anonymous", expires: -1 },
      { name: "sgcookie", value: "anonymous", expires: -1 },
    ]),
    false,
  );
});

test("an active account identity cookie counts as authenticated", () => {
  assert.equal(
    hasAuthenticatedCookies([
      { name: "tracknick", value: "account", expires: -1 },
    ]),
    true,
  );
});

test("expired account cookies do not count as authenticated", () => {
  assert.equal(
    hasAuthenticatedCookies([
      { name: "tracknick", value: "account", expires: 1 },
    ]),
    false,
  );
});
