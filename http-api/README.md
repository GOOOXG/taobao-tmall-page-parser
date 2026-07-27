# 淘宝/天猫商品解析 HTTP API

本地 Node 服务调用本目录内独立的 `taobao-tmall-page-parser.mjs`，复用已登录 Chrome 获取统一商品 JSON。

要求 Node.js 20 或更高版本。

默认地址：

```text
API：        http://127.0.0.1:3210
健康检查：  http://127.0.0.1:3210/health
解析接口：  http://127.0.0.1:3210/parse
Chrome CDP： http://127.0.0.1:9224
```

## 一、启动 Chrome

API 需要连接已经登录淘宝/天猫的 Chrome。使用独立 Chrome 配置启动：

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9224 `
  --user-data-dir="C:\tmp\taobao-parser-profile"
```

首次启动时，在这个 Chrome 窗口中登录淘宝。之后会复用该配置中的登录状态。

`--user-data-dir` 是 Chrome 的独立用户数据目录，用来保存 Cookie、登录状态、缓存和浏览记录；它不是项目代码目录。建议继续使用 `C:\tmp\taobao-parser-profile`，不要改成 `http-api` 项目目录，避免账号数据混入源码、依赖和 Git 文件。

如果确实要放在项目附近，也必须使用单独的子目录，例如 `http-api\chrome-profile`，并将该目录加入 `.gitignore`；不要直接使用 `http-api` 本身。

确认调试端口正常：

```powershell
Test-NetConnection 127.0.0.1 -Port 9224
```

必须看到：

```text
TcpTestSucceeded : True
```

## 二、启动 HTTP API

打开新的 PowerShell 窗口：

```powershell
cd "C:\Users\GOOXG\Documents\电商插件\http-api"
npm install
npm start
```

启动成功后会显示：

```text
Taobao/Tmall parser API: http://127.0.0.1:3210
Chrome CDP: http://127.0.0.1:9224
```

保持这个窗口运行，不要关闭它。

只需要首次运行 `npm install`。以后启动 API 时执行：

```powershell
cd "C:\Users\GOOXG\Documents\电商插件\http-api"
npm start
```

## 三、检查 API 是否启动

```powershell
Invoke-RestMethod http://127.0.0.1:3210/health
```

正常结果：

```json
{
  "status": "ok",
  "service": "taobao-tmall-parser"
}
```

## 四、调用商品解析接口

接口只接收商品 ID，不需要传淘宝或天猫链接：

```powershell
$body = @{ itemId = "901024796701" } | ConvertTo-Json

$result = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3210/parse `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 300

$result | ConvertTo-Json -Depth 100
```

请求内容：

```json
{
  "itemId": "901024796701"
}
```

成功时返回统一商品 JSON：

```text
shopInfo -> spuInfo -> skuInfo -> detailPageInfo
```

解析流程为：新建商品标签页、打开商品页面、等待数据、加载详情图片、调用 MJS 解析、关闭商品标签页。已登录的 Chrome 不会关闭。

## 五、保存解析结果

将接口结果保存为 JSON 文件：

```powershell
$body = @{ itemId = "901024796701" } | ConvertTo-Json
$result = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3210/parse `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 300

$result | ConvertTo-Json -Depth 100 | `
  Set-Content -LiteralPath ".\item-901024796701.json" -Encoding UTF8
```

## 六、结束 API

在运行 `npm start` 的 PowerShell 窗口中按：

```text
Ctrl + C
```

也可以从另一个 PowerShell 窗口结束监听 `3210` 端口的 Node 进程：

```powershell
$connection = Get-NetTCPConnection `
  -LocalPort 3210 `
  -State Listen `
  -ErrorAction SilentlyContinue

if ($connection) {
  Stop-Process -Id $connection.OwningProcess
}
```

结束 API 不会自动关闭 Chrome。需要结束专用 Chrome 时，直接关闭 Chrome 窗口即可。

## 七、配置端口

默认配置为：

```text
PARSER_HOST=127.0.0.1
PARSER_PORT=3210
TAOBAO_CDP_URL=http://127.0.0.1:9224
```

PowerShell 临时修改示例：

```powershell
$env:PARSER_PORT = "3211"
$env:TAOBAO_CDP_URL = "http://127.0.0.1:9225"
npm start
```

## 八、公网使用时的 API Token

当服务通过 Cloudflare Tunnel 暴露到公网时，必须设置 `PARSER_API_TOKEN`。服务支持以下任一种请求头：

```text
Authorization: Bearer <token>
X-Parser-Token: <token>
```

PowerShell 启动示例：

```powershell
$env:PARSER_API_TOKEN = Get-Content -LiteralPath "C:\tmp\taobao-parser-api-token.txt" -Raw
npm start
```

带 Token 调用：

```powershell
$token = (Get-Content -LiteralPath "C:\tmp\taobao-parser-api-token.txt" -Raw).Trim()
$body = @{ itemId = "901024796701" } | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri https://mjs.gooxg.com/parse `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 300
```

## 九、Cloudflare 固定域名与永久 Tunnel

当前使用 Cloudflare 命名 Tunnel（永久隧道）：

```text
Tunnel 名称：taobao-tmall-parser
Tunnel ID：  5a398e75-f807-4e30-ae11-b5fee3954add
固定域名：  https://mjs.gooxg.com
源站：      http://127.0.0.1:3210
配置文件：  C:\tmp\taobao-parser-cloudflared\config.yml
```

域名路由已经绑定到该 Tunnel。命名 Tunnel 本身不会因为命令窗口关闭而删除，但本机必须有一个持续运行的 `cloudflared` 连接器，公网域名才会可用。

手动启动连接器：

```powershell
& "C:\tmp\cloudflared\cloudflared.exe" `
  tunnel `
  --config "C:\tmp\taobao-parser-cloudflared\config.yml" `
  run taobao-tmall-parser
```

查看 Tunnel 与连接器状态：

```powershell
& "C:\tmp\cloudflared\cloudflared.exe" `
  tunnel info taobao-tmall-parser
```

当前连接器需要持续运行；本机目前使用手动启动命令运行，没有注册 Windows 服务或登录计划任务。若连接器进程结束，Tunnel 和域名绑定仍然保留，但公网请求会暂时无法到达本地 API。

停止当前运行的连接器进程（不会删除 Tunnel 或域名绑定）：

```powershell
$processes = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" |
  Where-Object { $_.CommandLine -like '*taobao-parser-cloudflared*' }

$processes | ForEach-Object { Stop-Process -Id $_.ProcessId }
```

验证公网入口：

```powershell
Invoke-RestMethod https://mjs.gooxg.com/health
```

## 十、错误结果

商品 ID 错误时返回 HTTP `400`：

```json
{
  "code": 1,
  "message": "商品 ID 格式不正确，只能输入 6 至 20 位数字",
  "data": null,
  "recordTime": null
}
```

Chrome 未启动或调试端口不可用时返回 HTTP `503`。商品页面加载失败时返回 HTTP `502`。

## 十一、安全边界

服务默认只监听本机 `127.0.0.1`，不配置 CORS，也不接受用户提供的任意 URL。不要将 `PARSER_HOST` 改为 `0.0.0.0` 暴露到局域网或公网。
