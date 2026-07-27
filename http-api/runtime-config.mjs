const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;
const DEFAULT_CDP_URL = "http://127.0.0.1:9224";
const BROWSER_MODES = new Set(["cdp", "managed"]);

export function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`布尔配置值无效：${value}`);
}

function parsePort(value) {
  const port = Number(value || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PARSER_PORT 无效：${value}`);
  }
  return port;
}

export function loadRuntimeConfig(env = process.env) {
  const mode = String(env.PARSER_BROWSER_MODE || "cdp").trim().toLowerCase();
  if (!BROWSER_MODES.has(mode)) {
    throw new Error("PARSER_BROWSER_MODE 只能是 cdp 或 managed");
  }

  const browser =
    mode === "managed"
      ? {
          mode,
          profileDir: String(env.PARSER_CHROME_PROFILE_DIR || "").trim(),
          headless: parseBoolean(env.PARSER_HEADLESS, true),
          executablePath:
            String(env.PARSER_CHROME_EXECUTABLE_PATH || "").trim() || null,
        }
      : {
          mode,
          cdpUrl: String(env.TAOBAO_CDP_URL || DEFAULT_CDP_URL).trim(),
        };

  if (mode === "managed" && !browser.profileDir) {
    throw new Error("managed 模式必须设置 PARSER_CHROME_PROFILE_DIR");
  }

  return {
    host: String(env.PARSER_HOST || DEFAULT_HOST).trim(),
    port: parsePort(env.PARSER_PORT),
    browser,
  };
}
