# 淘宝/天猫商品解析 HTTP API

本地 Node 服务调用本目录内独立的 `taobao-tmall-page-parser.mjs`，复用已登录 Chrome 获取统一商品 JSON。

要求 Node.js 20 或更高版本。

## 安装与启动

```powershell
cd "C:\Users\GOOXG\Documents\电商插件\http-api"
npm install
npm start
```

默认配置：

```text
API:        http://127.0.0.1:3210
Chrome CDP: http://127.0.0.1:9224
```

可通过环境变量修改：`PARSER_HOST`、`PARSER_PORT`、`TAOBAO_CDP_URL`。

## 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:3210/health
```

## 解析商品

```powershell
$body = @{ itemId = "901024796701" } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3210/parse `
  -ContentType "application/json" `
  -Body $body
```

请求：

```json
{"itemId":"901024796701"}
```

成功时直接返回 MJS 解析器的完整 JSON。服务会新建商品标签页，解析完成后关闭该标签页，不关闭 Chrome。

## 安全边界

服务默认只监听本机 `127.0.0.1`，不配置 CORS，也不接受用户提供的任意 URL。不要将 `PARSER_HOST` 改为 `0.0.0.0` 暴露到局域网或公网。
