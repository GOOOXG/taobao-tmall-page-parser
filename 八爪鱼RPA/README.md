# 八爪鱼 RPA Python 版本

入口文件：`main.py`

执行函数：

```python
main
```

输入参数：

```text
itemId = 商品 ID
```

返回值是完整 Python 字典，结构保持：

```text
shopInfo -> spuInfo -> skuInfo -> detailPageInfo
```

## 工作方式

该版本不会启动新的 Chrome 进程，也不会关闭当前 Chrome。

每次执行时会：

1. 自动识别已经运行、已经登录且开启 CDP 的 Chrome。
2. 在这个 Chrome 中新建一个商品标签页。
3. 根据 `itemId` 自动尝试淘宝和天猫商品地址。
4. 加载详情内容并提取数据。
5. 关闭本次新建的商品标签页。
6. 保留 Chrome、登录状态和原有标签页。

## 必要条件

当前 Chrome 必须在启动时开启远程调试。端口不需要固定，脚本会从 Chrome 进程参数和 `DevToolsActivePort` 自动识别。

## 开启 Chrome CDP 完整教程

### 1. 完全退出原 Chrome

在 Chrome 菜单中选择“退出”，然后打开任务管理器确认没有仍在运行的 `chrome.exe`。

如果旧 Chrome 仍在后台运行，新的启动参数会被旧进程忽略，CDP 实际不会开启。

### 2. 创建独立 Profile 并使用动态端口启动

在 PowerShell 中执行：

当前项目使用的启动方式：

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=0 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="C:\tmp\taobao-parser-profile"
```

在这个 Chrome 中登录淘宝或天猫后保持浏览器运行。脚本不会读取或返回 Cookie。

`C:\tmp\taobao-parser-profile` 是账号登录状态的存储目录。换电脑时可以使用该电脑上的其他目录，但不要直接使用项目源码目录。

Chrome 136 及更高版本通常要求远程调试配合非默认的 `--user-data-dir`，因此不要删除该参数。

### 3. 登录并人工确认

1. 在新打开的 Chrome 中访问淘宝首页。
2. 使用扫码、短信或密码完成登录。
3. 刷新首页，确认显示正确账号。
4. 手动打开一个淘宝或天猫商品页，确认没有验证码或安全验证。
5. 保持该 Chrome 运行。

Chrome 会把实际端口写入 Profile 下的 `DevToolsActivePort`，换电脑、换端口时无需修改 Python 代码。

脚本也兼容已经使用 `9222`、`9224` 等固定端口启动的浏览器。

## 校验 CDP 是否开启

### PowerShell 校验动态端口

```powershell
$profile = "C:\tmp\taobao-parser-profile"
$port = Get-Content -LiteralPath "$profile\DevToolsActivePort" | Select-Object -First 1
$port
Invoke-RestMethod "http://127.0.0.1:$port/json/version"
```

成功时会看到类似字段：

```text
Browser              : Chrome/150.0...
Protocol-Version     : 1.3
webSocketDebuggerUrl : ws://127.0.0.1:端口/devtools/browser/...
```

以下任一种情况都表示 CDP 尚未正确开启：

```text
DevToolsActivePort 文件不存在
无法连接到远程服务器
webSocketDebuggerUrl 为空
```

### 使用八爪鱼校验

将 `main.py` 完整代码粘贴到节点后，把“执行函数”临时选择为：

```text
checkChrome
```

该函数不需要输入参数，也不会打开商品页。成功结果示例：

```json
{
  "code": 0,
  "message": null,
  "data": {
    "connected": true,
    "endpoint": "http://127.0.0.1:动态端口",
    "browser": "Chrome/150.0..."
  },
  "recordTime": null
}
```

校验成功后，将执行函数切回 `main`，再绑定 `itemId`。

### 固定端口校验

如果启动参数使用的是 `--remote-debugging-port=9224`，可以直接执行：

```powershell
Invoke-RestMethod http://127.0.0.1:9224/json/version
```

### 无法连接普通方式打开的 Chrome

如果 Chrome 启动时没有 `--remote-debugging-port`，运行中的其他程序不能再给它补开 CDP。这是 Chrome 的安全边界，不是更换 Python 包可以解决的问题。

这种情况需要先正常关闭 Chrome，再使用上面的动态端口命令启动一次，然后在该浏览器中登录账号。此后保持它运行即可。

### 多个调试浏览器

脚本优先选择已经打开淘宝或天猫页面的 Chrome。若同时发现多个无法区分的调试浏览器，会返回错误而不是误用其他账号。

确实需要指定时，可在八爪鱼运行环境中设置：

```text
CHROME_CDP_URL=http://127.0.0.1:实际端口
```

## 不需要安装 Python 包

该版本只使用 Python 标准库，直接通过 HTTP、Socket 和 WebSocket 调用 Chrome DevTools Protocol，并兼容 Python 3.7 及以上版本。

不需要安装：

```text
playwright
selenium
requests
websocket-client
ChromeDriver
```

也不需要下载任何 Playwright 浏览器。

## 八爪鱼节点配置

1. 新建“执行Python代码”节点。
2. 将 `main.py` 的完整内容粘贴到“Python代码段”。
3. “执行函数”选择 `main`。
4. 输入参数名称使用 `itemId`。
5. 将商品 ID 变量绑定到 `itemId`。
6. “结果保存至”选择需要接收结果的变量。

建议先运行一次 `checkChrome`，成功后再切换回 `main`。

不要继续使用截图中的 `main(msg)`。粘贴本文件后入口应显示为：

```python
def main(itemId):
```

## 返回示例

成功：

```json
{
  "code": 0,
  "message": null,
  "data": {
    "shopInfo": {},
    "spuInfo": {},
    "skuInfo": {},
    "detailPageInfo": {}
  },
  "recordTime": null
}
```

失败时同样返回结构化结果，不会让八爪鱼得到无格式异常：

```json
{
  "code": 1,
  "message": "错误原因",
  "data": null,
  "recordTime": null
}
```

## 注意

- 执行期间不要在同一个新建商品标签页中手动操作。
- 淘宝出现验证码或安全验证时，需要在当前 Chrome 中人工完成。
- 支持多个八爪鱼任务同时使用同一个 Chrome 和账号；每个任务创建独立标签页并只关闭自己的标签页。
- 脚本不读取、不导出 Cookie，也不会修改 `navigator.webdriver` 或绕过验证码。
- 复用已登录浏览器可以减少重复登录，但不能保证淘宝永不触发安全验证。
- 并发数量和请求频率由使用者控制；并发越高，页面加载资源占用和触发平台安全验证的概率通常越高。
- 当前 Chrome 如果未开启 CDP，脚本不会偷偷新开浏览器，而是返回连接失败。
