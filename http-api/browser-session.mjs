import { mkdir } from "node:fs/promises";

import { chromium } from "playwright";

import { ApiError } from "./api-error.mjs";

const LOGIN_URL =
  "https://login.taobao.com/member/login.jhtml?redirectURL=https%3A%2F%2Fwww.taobao.com%2F";
const AUTH_COOKIE_NAMES = new Set([
  "tracknick",
  "lgc",
  "_nk_",
  "unb",
]);
const QR_SELECTORS = [
  '[class*="qrcode"] canvas',
  '[class*="qrcode"] img',
  '[id*="qrcode"] canvas',
  '[id*="qrcode"] img',
  '[class*="qr-code"] canvas',
  '[class*="qr-code"] img',
  'img[src*="qrcode"]',
];

export function hasAuthenticatedCookies(cookies) {
  const now = Date.now() / 1000;
  return cookies.some(
    (cookie) =>
      AUTH_COOKIE_NAMES.has(cookie.name) &&
      cookie.value &&
      (cookie.expires === -1 || cookie.expires > now),
  );
}

export class BrowserSession {
  constructor(config) {
    this.config = config;
    this.cdpBrowserPromise = null;
    this.managedContextPromise = null;
    this.loginPage = null;
  }

  async getContext() {
    if (this.config.mode === "managed") {
      return this.#getManagedContext();
    }
    return this.#getCdpContext();
  }

  async #getCdpContext() {
    if (!this.cdpBrowserPromise) {
      this.cdpBrowserPromise = chromium
        .connectOverCDP(this.config.cdpUrl)
        .then((browser) => {
          browser.on("disconnected", () => {
            this.cdpBrowserPromise = null;
            this.loginPage = null;
          });
          return browser;
        })
        .catch((error) => {
          this.cdpBrowserPromise = null;
          throw new ApiError(
            503,
            `无法连接 Chrome CDP：${error.message}`,
          );
        });
    }

    const browser = await this.cdpBrowserPromise;
    const context = browser.contexts()[0];
    if (!context) {
      throw new ApiError(503, "没有找到可用的 Chrome 浏览器上下文");
    }
    return context;
  }

  async #getManagedContext() {
    if (!this.managedContextPromise) {
      this.managedContextPromise = mkdir(this.config.profileDir, {
        recursive: true,
      })
        .then(() =>
          chromium.launchPersistentContext(this.config.profileDir, {
            headless: this.config.headless,
            executablePath:
              this.config.executablePath || chromium.executablePath(),
            locale: "zh-CN",
            timezoneId: "Asia/Shanghai",
            viewport: { width: 1440, height: 1000 },
          }),
        )
        .then((context) => {
          context.on("close", () => {
            this.managedContextPromise = null;
            this.loginPage = null;
          });
          return context;
        })
        .catch((error) => {
          this.managedContextPromise = null;
          throw new ApiError(503, `无法启动托管 Chromium：${error.message}`);
        });
    }
    return this.managedContextPromise;
  }

  async getAccountStatus() {
    const context = await this.getContext();
    const cookies = await context.cookies([
      "https://www.taobao.com/",
      "https://www.tmall.com/",
    ]);
    const authenticated = hasAuthenticatedCookies(cookies);

    if (authenticated && this.loginPage && !this.loginPage.isClosed()) {
      await this.loginPage.close().catch(() => {});
      this.loginPage = null;
    }

    return {
      state: authenticated
        ? "authenticated"
        : this.loginPage && !this.loginPage.isClosed()
          ? "pending"
          : "unauthenticated",
      loginPageOpen: Boolean(this.loginPage && !this.loginPage.isClosed()),
      browserMode: this.config.mode,
    };
  }

  async startLogin() {
    const current = await this.getAccountStatus();
    if (current.state === "authenticated") return current;

    const context = await this.getContext();
    if (!this.loginPage || this.loginPage.isClosed()) {
      this.loginPage = await context.newPage();
    }

    try {
      await this.loginPage.goto(LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await this.loginPage.waitForTimeout(1_500);
    } catch (error) {
      throw new ApiError(502, `淘宝登录页加载失败：${error.message}`);
    }

    return {
      state: "pending",
      loginPageOpen: true,
      browserMode: this.config.mode,
      qrcodeEndpoint: "/login/qrcode",
    };
  }

  async getLoginScreenshot() {
    if (!this.loginPage || this.loginPage.isClosed()) {
      throw new ApiError(409, "请先访问 GET /login 创建登录会话");
    }

    for (const frame of this.loginPage.frames()) {
      for (const selector of QR_SELECTORS) {
        const locator = frame.locator(selector).first();
        if (!(await locator.isVisible().catch(() => false))) continue;
        const box = await locator.boundingBox().catch(() => null);
        if (!box || box.width < 100 || box.height < 100) continue;
        return {
          buffer: await locator.screenshot({ type: "png" }),
          kind: "qrcode",
        };
      }
    }

    return {
      buffer: await this.loginPage.screenshot({ type: "png" }),
      kind: "page",
    };
  }

  async logout() {
    const context = await this.getContext();
    await context.clearCookies();
    if (this.loginPage && !this.loginPage.isClosed()) {
      await this.loginPage.close().catch(() => {});
    }
    this.loginPage = null;
    return {
      state: "unauthenticated",
      loginPageOpen: false,
      browserMode: this.config.mode,
    };
  }

  async close() {
    if (this.config.mode !== "managed" || !this.managedContextPromise) return;
    const context = await this.managedContextPromise.catch(() => null);
    await context?.close().catch(() => {});
    this.managedContextPromise = null;
    this.loginPage = null;
  }
}

export function createBrowserSession(config) {
  return new BrowserSession(config);
}
