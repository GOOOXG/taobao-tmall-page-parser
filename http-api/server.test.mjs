import assert from "node:assert/strict";
import test from "node:test";

import { createParserServer } from "./server.mjs";

async function withServer(options, run) {
  const server = createParserServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createFakeBrowserSession() {
  const calls = [];
  return {
    calls,
    async getAccountStatus() {
      calls.push("status");
      return { state: "unauthenticated", loginPageOpen: false };
    },
    async startLogin() {
      calls.push("login");
      return {
        state: "pending",
        loginPageOpen: true,
      };
    },
    async getLoginScreenshot() {
      calls.push("qrcode");
      return { buffer: Buffer.from("png-data"), kind: "page" };
    },
    async logout() {
      calls.push("logout");
      return { state: "unauthenticated", loginPageOpen: false };
    },
  };
}

test("health reports the configured browser mode without authentication", async () => {
  await withServer(
    {
      parseItem: async () => null,
      browserSession: createFakeBrowserSession(),
      browserMode: "managed",
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        status: "ok",
        service: "taobao-tmall-parser",
        browserMode: "managed",
      });
    },
  );
});

test("parse accepts an item ID without an API token", async () => {
  let receivedItemId = null;
  const result = { code: 0, message: null, data: { ok: true } };

  await withServer(
    {
      parseItem: async (itemId) => {
        receivedItemId = itemId;
        return result;
      },
      browserSession: createFakeBrowserSession(),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/parse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: "901024796701" }),
      });

      assert.equal(response.status, 200);
      assert.equal(receivedItemId, "901024796701");
      assert.deepEqual(await response.json(), result);
    },
  );
});

test("login routes expose the page, status, QR image, and logout", async () => {
  const browserSession = createFakeBrowserSession();

  await withServer(
    { parseItem: async () => null, browserSession },
    async (baseUrl) => {
      const statusResponse = await fetch(`${baseUrl}/login/status`);
      assert.equal(statusResponse.status, 200);
      assert.equal((await statusResponse.json()).data.state, "unauthenticated");

      const loginResponse = await fetch(`${baseUrl}/login`);
      assert.equal(loginResponse.status, 200);
      assert.match(loginResponse.headers.get("content-type"), /text\/html/);
      const loginHtml = await loginResponse.text();
      assert.match(loginHtml, /淘宝账号登录/);
      assert.match(loginHtml, /src="\/login\/qrcode"/);
      assert.match(loginHtml, /fetch\("\/login\/status"/);

      const qrResponse = await fetch(`${baseUrl}/login/qrcode`);
      assert.equal(qrResponse.status, 200);
      assert.equal(qrResponse.headers.get("content-type"), "image/png");
      assert.equal(qrResponse.headers.get("x-parser-screenshot"), "page");
      assert.deepEqual(Buffer.from(await qrResponse.arrayBuffer()), Buffer.from("png-data"));

      const logoutResponse = await fetch(`${baseUrl}/logout`, {
        method: "POST",
      });
      assert.equal(logoutResponse.status, 200);
      assert.equal((await logoutResponse.json()).data.state, "unauthenticated");
    },
  );

  assert.deepEqual(browserSession.calls, [
    "status",
    "login",
    "qrcode",
    "logout",
  ]);
});

test("known routes reject unsupported methods", async () => {
  await withServer(
    {
      parseItem: async () => null,
      browserSession: createFakeBrowserSession(),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/parse`);
      assert.equal(response.status, 405);
    },
  );
});
