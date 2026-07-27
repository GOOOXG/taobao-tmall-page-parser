# 淘宝/天猫商品解析 HTTP API

Node 服务调用本目录内独立的 `taobao-tmall-page-parser.mjs`，输出统一商品 JSON：

```text
shopInfo -> spuInfo -> skuInfo -> detailPageInfo
```

要求 Node.js 20 或更高版本。接口不使用 API Token，默认只监听 `127.0.0.1`。

## 运行模式

| 模式 | 用途 | 浏览器与账号数据位置 |
| --- | --- | --- |
| `managed` | Linux 服务器部署 | 服务器自行启动 Chromium，Profile 保存在服务器 |
| `cdp` | 本机兼容模式 | 连接当前机器上已经启动的 Chrome CDP |

服务器部署必须使用 `managed`，不依赖用户电脑、用户电脑的 Chrome 或本地 Profile。

## 服务器安装

以下命令在目标 Linux 服务器执行：

```bash
cd /opt/taobao-tmall-page-parser/http-api
npm ci
npx playwright install --with-deps chromium
sudo mkdir -p /var/lib/taobao-parser/chrome-profile
sudo chown -R "$(id -u):$(id -g)" /var/lib/taobao-parser
```

启动服务器版 API：

```bash
export PARSER_BROWSER_MODE=managed
export PARSER_CHROME_PROFILE_DIR=/var/lib/taobao-parser/chrome-profile
export PARSER_HEADLESS=true
export PARSER_HOST=127.0.0.1
export PARSER_PORT=3210
npm start
```

服务会在第一次访问 `/login`、`/login/status` 或 `/parse` 时启动服务器上的 Chromium。

## 最简单的登录方式

部署并绑定域名后，只需在浏览器打开：

```text
https://你的域名/login
```

这就是完整登录入口。页面会自动创建服务器端登录会话、显示淘宝二维码并检查扫码结果，不需要手动调用其他接口。扫码成功后会显示“登录成功”，账号状态自动持久化。

暂未配置域名时，也可以直接使用：

```text
http://127.0.0.1:3210/login
```

服务器默认只监听回环地址。暂时通过 SSH 使用时，将服务器端口转发到管理电脑：

```bash
ssh -L 3210:127.0.0.1:3210 user@server.example.com
```

然后在管理电脑浏览器打开：

```text
http://127.0.0.1:3210/login
```

扫码成功后，Cookie 由服务器 Chromium 自动写入：

```text
/var/lib/taobao-parser/chrome-profile
```

接口不会返回原始 Cookie。服务或服务器重启后继续读取该目录，不需要从用户电脑复制浏览器数据。

### 绑定域名

先把域名的 DNS 记录指向服务器，再使用 Nginx 将域名代理到本机 `3210` 端口。仓库中的 [nginx-taobao-parser.conf.example](nginx-taobao-parser.conf.example) 可以直接作为配置模板：

```bash
sudo cp nginx-taobao-parser.conf.example /etc/nginx/conf.d/taobao-parser.conf
sudo nano /etc/nginx/conf.d/taobao-parser.conf
sudo nginx -t
sudo systemctl reload nginx
```

将示例中的 `mjs.example.com` 改成实际域名，并使用 Certbot 或现有证书配置 HTTPS。完成后访问：

```text
https://你的域名/login
```

登录页内部使用同域相对地址加载二维码和检查状态，因此反向代理后不需要修改代码。`/login/qrcode` 与 `/login/status` 是登录页内部接口，正常使用时无需单独访问。

## HTTP 接口

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 检查 API 进程 |
| `GET` | `/login` | 打开淘宝扫码登录页面 |
| `GET` | `/login/status` | 登录页内部查询登录状态 |
| `GET` | `/login/qrcode` | 登录页内部获取二维码 PNG |
| `POST` | `/logout` | 清除当前 Profile 中的淘宝 Cookie |
| `POST` | `/parse` | 根据商品 ID 解析商品 |

登录状态示例：

```bash
curl -sS http://127.0.0.1:3210/login/status
```

```json
{
  "code": 0,
  "message": null,
  "data": {
    "state": "authenticated",
    "loginPageOpen": false,
    "browserMode": "managed"
  },
  "recordTime": "2026-07-27T00:00:00.000Z"
}
```

`state` 可能是：

```text
unauthenticated
pending
authenticated
```

## 商品解析

接口只接收 6 至 20 位商品 ID，不接收任意 URL：

```bash
curl -sS \
  --request POST \
  http://127.0.0.1:3210/parse \
  --header 'Content-Type: application/json' \
  --data '{"itemId":"901024796701"}'
```

保存完整 JSON：

```bash
curl -sS \
  --request POST \
  http://127.0.0.1:3210/parse \
  --header 'Content-Type: application/json' \
  --data '{"itemId":"901024796701"}' \
  --output item-901024796701.json
```

解析流程为：创建服务器 Chromium 标签页、打开淘宝或天猫、加载详情、执行 MJS、关闭商品标签页。Chromium 和账号 Profile 不会在每次请求后删除。

## 退出账号

```bash
curl -sS --request POST http://127.0.0.1:3210/logout
```

该接口清除当前 Profile 的 Cookie。需要彻底重置浏览器状态时，先停止服务，再删除 `PARSER_CHROME_PROFILE_DIR` 中的数据。

## systemd

仓库提供 [taobao-parser.service.example](taobao-parser.service.example)。修改其中的 `User`、路径和 Node 位置后安装：

```bash
sudo cp taobao-parser.service.example /etc/systemd/system/taobao-parser.service
sudo systemctl daemon-reload
sudo systemctl enable --now taobao-parser
sudo systemctl status taobao-parser
```

查看日志：

```bash
journalctl -u taobao-parser -f
```

重启和停止：

```bash
sudo systemctl restart taobao-parser
sudo systemctl stop taobao-parser
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PARSER_BROWSER_MODE` | `cdp` | 服务器使用 `managed` |
| `PARSER_CHROME_PROFILE_DIR` | 无 | `managed` 必填，持久化 Profile 目录 |
| `PARSER_HEADLESS` | `true` | 托管 Chromium 是否无界面运行 |
| `PARSER_CHROME_EXECUTABLE_PATH` | Playwright Chromium | 可选自定义 Chromium 路径 |
| `PARSER_HOST` | `127.0.0.1` | API 监听地址 |
| `PARSER_PORT` | `3210` | API 端口 |
| `TAOBAO_CDP_URL` | `http://127.0.0.1:9224` | 仅 `cdp` 模式使用 |

## 本机 CDP 兼容模式

需要继续连接本机已有 Chrome 时：

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9224 `
  --user-data-dir="C:\tmp\taobao-parser-profile"

$env:PARSER_BROWSER_MODE = "cdp"
$env:TAOBAO_CDP_URL = "http://127.0.0.1:9224"
npm start
```

服务器与 Docker 部署不使用该模式。

## 安全边界

本项目按要求不使用 API Token。`/login`、`/logout` 和 `/parse` 能操作登录账号，不应直接暴露到公网。

推荐保持 `127.0.0.1`，通过 SSH 转发、私有 VPN 或反向代理 IP 白名单访问。若设置 `PARSER_HOST=0.0.0.0`，必须同时配置服务器防火墙，只允许可信来源地址。

服务不配置 CORS，不接受用户提供的任意 URL，也不通过接口返回 Cookie。

## 常见错误

| HTTP | 原因 |
| --- | --- |
| `400` | 商品 ID 或 JSON 格式错误 |
| `409` | 未先打开 `/login` 就请求二维码 |
| `415` | Content-Type 不是 `application/json` |
| `502` | 淘宝/天猫页面或登录页加载失败 |
| `503` | Chromium 无法启动或 CDP 无法连接 |
