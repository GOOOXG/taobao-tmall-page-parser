import http from "node:http";
import { pathToFileURL } from "node:url";

import { parseTaobaoTmallPage } from "../mjs-parser/taobao-tmall-page-parser.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;
const DEFAULT_CDP_URL = "http://127.0.0.1:9224";
const MAX_BODY_BYTES = 16 * 1024;
const ITEM_ID_PATTERN = /^\d{6,20}$/;

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function parseItemIdFromBody(body) {
  const itemId = String(body?.itemId ?? "").trim();
  if (!ITEM_ID_PATTERN.test(itemId)) {
    throw new ApiError(400, "商品 ID 格式不正确，只能输入 6 至 20 位数字");
  }
  return itemId;
}

export function serializeError(error) {
  return {
    code: 1,
    message: error instanceof Error ? error.message : "解析失败",
    data: null,
    recordTime: null,
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

async function readJsonBody(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "Content-Type 必须是 application/json");
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new ApiError(413, "请求体不能超过 16 KB");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "请求体不是有效 JSON");
  }
}

let browserPromise = null;

async function getBrowser(cdpUrl) {
  if (!browserPromise) {
    browserPromise = import("playwright")
      .then(({ chromium }) => chromium.connectOverCDP(cdpUrl))
      .then((browser) => {
        browser.on("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((error) => {
        browserPromise = null;
        throw new ApiError(503, `无法连接已登录的 Chrome：${error.message}`);
      });
  }
  return browserPromise;
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
        throw new Error(`页面商品 ID ${runtimeItemId} 与输入 ID ${itemId} 不一致`);
      }
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new ApiError(502, `商品页面加载失败：${errors.at(-1) || "没有读取到商品数据"}`);
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

export async function parseItemById(
  itemId,
  { cdpUrl = DEFAULT_CDP_URL } = {},
) {
  const browser = await getBrowser(cdpUrl);
  const context = browser.contexts()[0];
  if (!context) {
    throw new ApiError(503, "没有找到可用的 Chrome 浏览器上下文");
  }

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
  parseItem = parseItemById,
  cdpUrl = DEFAULT_CDP_URL,
} = {}) {
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  };

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok", service: "taobao-tmall-parser" });
      return;
    }

    if (url.pathname === "/parse" && request.method !== "POST") {
      sendJson(response, 405, serializeError(new Error("仅支持 POST /parse")));
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/parse") {
      sendJson(response, 404, serializeError(new Error("接口不存在")));
      return;
    }

    try {
      const itemId = parseItemIdFromBody(await readJsonBody(request));
      const result = await enqueue(() => parseItem(itemId, { cdpUrl }));
      sendJson(response, 200, result);
    } catch (error) {
      const statusCode = error instanceof ApiError ? error.statusCode : 500;
      sendJson(response, statusCode, serializeError(error));
    }
  });
}

export function startServer({
  host = process.env.PARSER_HOST || DEFAULT_HOST,
  port = Number(process.env.PARSER_PORT || DEFAULT_PORT),
  cdpUrl = process.env.TAOBAO_CDP_URL || DEFAULT_CDP_URL,
} = {}) {
  const server = createParserServer({ cdpUrl });
  server.listen(port, host, () => {
    console.log(`Taobao/Tmall parser API: http://${host}:${port}`);
    console.log(`Chrome CDP: ${cdpUrl}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
