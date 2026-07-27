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

## 八、API Token

设置 `PARSER_API_TOKEN` 后，`POST /parse` 必须携带相同的 Token。服务支持以下任一种请求头：

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
  -Uri http://127.0.0.1:3210/parse `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 300
```

## 九、错误结果

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

## 十、安全边界

服务默认只监听本机 `127.0.0.1`，不配置 CORS，也不接受用户提供的任意 URL。不要将 `PARSER_HOST` 改为 `0.0.0.0` 暴露到局域网或公网。
