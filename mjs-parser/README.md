# 默认 MJS 解析库

`taobao-tmall-page-parser.mjs` 使用同一套逻辑解析淘宝和天猫商品页。

## 导出入口

```javascript
import {
  parseTaobaoTmallPage,
  parseTaobaoPage,
  parseTmallPage,
} from "./taobao-tmall-page-parser.mjs";
```

三个入口指向同一实现，参数是 Playwright `Page`。

## 输出顺序

```text
shopInfo -> spuInfo -> skuInfo -> detailPageInfo
```

媒体顺序：

```text
videoCover -> video -> mainImages
```

视频、参数、尺码、工业文档等可选模块不存在时不会输出空模块。

## 账号管理

MJS 解析器本身不保存账号、密码或 Cookie。淘宝/天猫登录状态由运行商品页的 Chrome 用户数据目录管理；当前 HTTP API 默认连接的专用 Chrome 配置是：

```text
C:\tmp\taobao-parser-profile
```

### 启动专用 Chrome

关闭使用同一专用配置的旧 Chrome 窗口后，在 PowerShell 中执行：

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9224 `
  --user-data-dir="C:\tmp\taobao-parser-profile"
```

必须在这个专用 Chrome 窗口中管理淘宝账号。日常使用的 Chrome 与该目录不是同一个浏览器会话，在日常 Chrome 中登录或退出不会改变解析器使用的账号。

### 首次登录账号

1. 在专用 Chrome 中打开 `https://www.taobao.com/`。
2. 点击页面上的登录入口，使用密码、短信或手机淘宝扫码完成登录。
3. 登录后刷新淘宝首页，确认页面显示正确的用户昵称。
4. 打开任意淘宝或天猫商品页，确认页面没有再次要求登录或安全验证。
5. 保持专用 Chrome 运行，再启动 HTTP API 或执行 MJS 解析。

登录 Cookie 会保存在 `C:\tmp\taobao-parser-profile`。正常关闭后再次用相同命令启动，通常不需要重新登录；若淘宝要求重新验证，按页面提示重新登录即可。

### 退出当前账号

1. 等待正在进行的商品解析结束，避免切换过程中返回不完整数据。
2. 在专用 Chrome 中打开淘宝首页。
3. 点击当前账号头像或昵称，选择“退出登录”。
4. 同时打开天猫首页确认已退出；淘宝与天猫通常共享登录状态，但应以页面实际显示为准。
5. 刷新当前商品页，确认页面已显示未登录状态。

退出只清除当前淘宝/天猫会话，不会删除 MJS 文件、HTTP API 或 Chrome 专用配置目录。

### 更换账号

1. 先按“退出当前账号”完成退出，不要直接覆盖正在使用的会话。
2. 关闭仍显示旧账号的淘宝/天猫标签页，或在退出后逐个刷新。
3. 在同一个专用 Chrome 中登录新账号。
4. 在淘宝首页和一个商品页中核对新账号昵称及页面访问状态。
5. 再提交新的解析请求。

HTTP API 通过 CDP 连接正在运行的 Chrome，通常不需要因账号切换而重启。如果切换后商品页仍显示旧账号，先停止新的解析请求，关闭专用 Chrome，再用相同的 `--user-data-dir` 和 `--remote-debugging-port` 命令重新启动并核对账号。

### 使用完全独立的新账号配置

需要长期隔离多个淘宝账号时，为每个账号使用不同的 Chrome 用户数据目录和 CDP 端口，不要让两个 Chrome 进程同时使用同一个目录。例如：

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9225 `
  --user-data-dir="C:\tmp\taobao-parser-profile-account-2"
```

对应 HTTP API 启动前设置：

```powershell
$env:TAOBAO_CDP_URL = "http://127.0.0.1:9225"
npm start
```

每个账号配置目录都包含登录 Cookie 和浏览记录，不要提交到 GitHub，也不要与其他人共享。
