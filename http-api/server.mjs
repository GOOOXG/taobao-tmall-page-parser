import http from "node:http";
import { pathToFileURL } from "node:url";

import { ApiError } from "./api-error.mjs";
import { createBrowserSession } from "./browser-session.mjs";
import { loadRuntimeConfig } from "./runtime-config.mjs";
import { parseTaobaoTmallPage } from "./taobao-tmall-page-parser.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const ITEM_ID_PATTERN = /^\d{6,20}$/;
const ROUTES = new Map([
  ["/health", "GET"],
  ["/parse", "POST"],
  ["/login", "GET"],
  ["/login/status", "GET"],
  ["/login/qrcode", "GET"],
  ["/logout", "POST"],
]);

export function parseItemIdFromBody(body) {
  const itemId = String(body?.itemId ?? "").trim();
  if (!ITEM_ID_PATTERN.test(itemId)) {
    throw new ApiError(400, "?? ID ?????????? 6 ? 20 ???");
  }
  return itemId;
}

export function serializeError(error) {
  return {
    code: 1,
    message: error instanceof Error ? error.message : "????",
    data: null,
    recordTime: null,
  };
}

function createSuccess(data) {
  return {
    code: 0,
    message: null,
    data,
    recordTime: new Date().toISOString(),
  };
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(payload);
}

function sendPng(response, screenshot) {
  response.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": screenshot.buffer.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Parser-Screenshot": screenshot.kind,
  });
  response.end(screenshot.buffer);
}

function sendHtml(response, html) {
  const payload = Buffer.from(html);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  });
  response.end(payload);
}

function renderLoginPage(status) {
  const authenticated = status.state === "authenticated";
  const initialText = authenticated ? "?????" : "????";
  const qrMarkup = authenticated
    ? ""
    : '<div class="qr"><img id="qr" src="/login/qrcode" alt="???????"></div><button id="refresh" type="button">?????</button>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>??????</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f6; color: #17191c; font-family: Arial, "Microsoft YaHei", sans-serif; }
    main { width: min(92vw, 420px); padding: 40px 24px; text-align: center; }
    h1 { margin: 0 0 10px; font-size: 28px; letter-spacing: 0; }
    p { margin: 0 0 24px; color: #61656b; line-height: 1.6; }
    #status { display: inline-flex; align-items: center; min-height: 32px; margin-bottom: 18px; padding: 5px 12px; border: 1px solid #d9dcdf; border-radius: 6px; background: #fff; font-size: 14px; }
    #status.authenticated { border-color: #88b393; color: #17632b; }
    .qr { width: min(320px, 82vw); aspect-ratio: 1; margin: 0 auto 18px; display: grid; place-items: center; overflow: hidden; border: 1px solid #d9dcdf; border-radius: 8px; background: #fff; }
    .qr img { display: block; width: 100%; height: 100%; object-fit: contain; }
    button { min-height: 40px; padding: 8px 16px; border: 1px solid #b7bbc0; border-radius: 6px; background: #fff; color: #17191c; cursor: pointer; font-size: 14px; }
    button:hover { background: #eceef0; }
  </style>
</head>
<body>
  <main>
    <h1>??????</h1>
    <p>??????????????????????????</p>
    <div id="status" class="${authenticated ? "authenticated" : ""}">${initialText}</div>
    <div id="login-area">${qrMarkup}</div>
  </main>
  <script>
    const statusElement = document.getElementById("status");
    const loginArea = document.getElementById("login-area");
    const refreshButton = document.getElementById("refresh");
    const qrImage = document.getElementById("qr");

    function refreshQr() {
      if (qrImage) qrImage.src = "/login/qrcode?t=" + Date.now();
    }

    async function checkStatus() {
      try {
        const response = await fetch("/login/status", { cache: "no-store" });
        const result = await response.json();
        if (result.data?.state === "authenticated") {
          statusElement.textContent = "?????????????";
          statusElement.classList.add("authenticated");
          loginArea.hidden = true;
          return;
        }
        statusElement.textContent = "????";
      } catch {
        statusElement.textContent = "????????????";
      }
      setTimeout(checkStatus, 2000);
    }

    refreshButton?.addEventListener("click", refreshQr);
    if (${authenticated ? "false" : "true"}) checkStatus();
  </script>
</body>
</html>`;
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "Content-Type ??? application/json");
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new ApiError(413, "??????? 16 KB");
    }
    chunks.push(chunk);
  }

  try {
    const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "??????? JSON");
  }
}

async function loadItemPage(page, itemId) {
  const urls = [
    `https://item.taobao.com/item.htm?id=${itemId}`,
    `https://detail.tmall.com/item.htm?id=${itemId}`,
  ];
  const errors = [];

  for (const url of urls) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await page.waitForFunction(
        () => Boolean(window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res),
        null,
        { timeout: 120_000 },
      );
      const runtimeItemId = await page.evaluate(
        () => window.__ICE_APP_CONTEXT__.loaderData.home.data.res.item.itemId,
      );
      if (String(runtimeItemId) !== itemId) {
        throw new Error(`???? ID ${runtimeItemId} ??? ID ${itemId} ???`);
      }
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new ApiError(
    502,
    `?????????${errors.at(-1) || "?????????"}`,
  );
}

async function loadLazyDetails(page) {
  await page.evaluate(async () => {
    let previousHeight = 0;
    for (let index = 0; index < 100; index += 1) {
      window.scrollBy(0, 900);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const height = document.documentElement.scrollHeight;
      const atBottom = window.scrollY + window.innerHeight >= height - 20;
      if (atBottom && height === previousHeight) break;
      if (atBottom) previousHeight = height;
    }
  });
  await page.waitForTimeout(2_000);
}

export async function parseItemById(itemId, { browserSession }) {
  const context = await browserSession.getContext();
  const page = await context.newPage();
  try {
    await loadItemPage(page, itemId);
    await loadLazyDetails(page);
    return await parseTaobaoTmallPage(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export function createParserServer({
  parseItem,
  browserSession,
  browserMode = "cdp",
} = {}) {
  const session =
    browserSession ||
    createBrowserSession({
      mode: "cdp",
      cdpUrl: "http://127.0.0.1:9224",
    });
  const parse = parseItem || ((itemId) => parseItemById(itemId, { browserSession: session }));
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const expectedMethod = ROUTES.get(url.pathname);

    if (!expectedMethod) {
      sendJson(response, 404, serializeError(new Error("?????")));
      return;
    }
    if (request.method !== expectedMethod) {
      sendJson(
        response,
        405,
        serializeError(new Error(`??? ${expectedMethod} ${url.pathname}`)),
      );
      return;
    }

    try {
      if (url.pathname === "/health") {
        sendJson(response, 200, {
          status: "ok",
          service: "taobao-tmall-parser",
          browserMode,
        });
        return;
      }

      if (url.pathname === "/parse") {
        const itemId = parseItemIdFromBody(await readJsonBody(request));
        const result = await enqueue(() => parse(itemId));
        sendJson(response, 200, result);
        return;
      }

      if (url.pathname === "/login") {
        const login = await enqueue(() => session.startLogin());
        sendHtml(response, renderLoginPage(login));
        return;
      }

      if (url.pathname === "/login/status") {
        const status = await enqueue(() => session.getAccountStatus());
        sendJson(response, 200, createSuccess(status));
        return;
      }

      if (url.pathname === "/login/qrcode") {
        sendPng(response, await session.getLoginScreenshot());
        return;
      }

      const logout = await enqueue(() => session.logout());
      sendJson(response, 200, createSuccess(logout));
    } catch (error) {
      const statusCode = error instanceof ApiError ? error.statusCode : 500;
      sendJson(response, statusCode, serializeError(error));
    }
  });

  server.browserSession = session;
  return server;
}

export function startServer(config = loadRuntimeConfig()) {
  const browserSession = createBrowserSession(config.browser);
  const server = createParserServer({
    browserSession,
    browserMode: config.browser.mode,
  });

  server.listen(config.port, config.host, () => {
    console.log(`Taobao/Tmall parser API: http://${config.host}:${config.port}`);
    console.log(`Browser mode: ${config.browser.mode}`);
    if (config.browser.mode === "managed") {
      console.log(`Chrome profile: ${config.browser.profileDir}`);
      console.log(`Chrome headless: ${config.browser.headless}`);
    } else {
      console.log(`Chrome CDP: ${config.browser.cdpUrl}`);
    }
  });
  return server;
}

async function shutdown(server) {
  await new Promise((resolve) => server.close(resolve));
  await server.browserSession.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startServer();
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      if (stopping) return;
      stopping = true;
      await shutdown(server);
      process.exit(0);
    });
  }
}
