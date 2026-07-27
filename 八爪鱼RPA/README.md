# 八爪鱼 RPA Python 版本

该版本不安装任何第三方 Python 包，按三个步骤使用：

```text
步骤1：检查 CDP -> 步骤2：必要时启动 Chrome -> 步骤3：按商品 ID 解析
```

## 文件

| 文件 | 执行函数 | 输入参数 | 返回结果 |
| --- | --- | --- | --- |
| `步骤1-检查CDP.py` | `main` | 无 | `True` 或 `False` |
| `步骤2-启动Chrome-CDP.py` | `main` | 无 | 启动成功为 `True` |
| `main.py` | `main` | `itemId` | 完整商品 JSON 字典 |

三个文件都是可直接粘贴到八爪鱼“执行Python代码”节点的独立代码。

## 步骤1：检查 CDP

打开 [步骤1-检查CDP.py](步骤1-检查CDP.py)，将完整代码粘贴到八爪鱼节点。

配置：

```text
执行函数：main
输入参数：无
结果保存至：自定义布尔变量，例如 cdpEnabled
```

结果：

```text
True  = RPA 专用 Chrome 已启动，CDP 可以连接
False = 尚未启动，继续执行步骤2
```

检查时会创建一个临时空白标签页，以确认 CDP 确实能控制浏览器；检查完成后根据该标签页的 `targetId` 自动关闭它，不会关闭淘宝页或其他已有标签页。

## 步骤2：启动 Chrome CDP

仅当步骤1返回 `False` 时执行。

打开 [步骤2-启动Chrome-CDP.py](步骤2-启动Chrome-CDP.py)，将完整代码粘贴到新的八爪鱼节点。

配置：

```text
执行函数：main
输入参数：无
结果保存至：自定义布尔变量，例如 chromeStarted
```

代码会自动：

1. 查找电脑上的 Google Chrome。
2. 使用动态 CDP 端口启动专用 Chrome。
3. 使用持久化的独立 Profile。
4. 自动打开 `https://www.taobao.com/`。
5. 启动成功返回 `True`，失败返回 `False`。

Chrome 参数由 Python 自动执行，核心命令等价于：

```text
chrome.exe
--remote-debugging-port=0
--remote-debugging-address=127.0.0.1
--user-data-dir=%LOCALAPPDATA%\TaobaoRPA\ChromeProfile
https://www.taobao.com/
```

首次启动后，在新打开的 Chrome 中完成淘宝登录。不要关闭该浏览器。

账号状态保存在：

```text
%LOCALAPPDATA%\TaobaoRPA\ChromeProfile
```

以后再次运行步骤2会复用该 Profile。若 CDP Chrome 已经运行，代码不会再启动一个浏览器，只会打开淘宝首页并返回 `True`。

普通 Chrome 可以继续运行；RPA 专用 Chrome 使用独立 Profile，不与普通 Chrome 冲突。

登录完成后可以再次运行步骤1，结果应为：

```text
True
```

### 步骤2返回 False

步骤2仍保持布尔返回值。启动失败时会同时打印错误，并把完整原因保存到：

```text
%TEMP%\taobao-rpa-cdp-start-error.txt
```

## 步骤3：解析商品

打开 [main.py](main.py)，将完整代码粘贴到八爪鱼“执行Python代码”节点。

配置：

```text
执行函数：main
输入参数：itemId
输入值：商品 ID
结果保存至：商品结果变量
```

入口必须显示为：

```python
def main(itemId):
```

例如输入：

```text
901024796701
```

执行过程：

1. 自动识别步骤2启动的动态 CDP 端口。
2. 连接已经登录的 RPA 专用 Chrome。
3. 在该 Chrome 中新建商品标签页。
4. 根据商品 ID 自动加载淘宝或天猫页面。
5. 加载主图、视频、SKU、参数和图文详情。
6. 返回结构化商品数据。
7. 无论成功或失败，都只关闭本任务创建的商品标签页。
8. Chrome、账号和其他标签页保持运行。

支持多个 RPA 任务同时使用同一个 Chrome 和账号。每个任务使用独立标签页和独立 CDP Session。

## 输出结构

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

顺序保持：

```text
shopInfo -> spuInfo -> skuInfo -> detailPageInfo
```

失败：

```json
{
  "code": 1,
  "message": "错误原因",
  "data": null,
  "recordTime": null
}
```

## 环境要求

- Windows
- Python 3.7 或更高版本
- Google Chrome
- 不需要 Playwright
- 不需要 Selenium
- 不需要 requests
- 不需要 websocket-client
- 不需要 ChromeDriver

## 注意

- 首次使用必须在步骤2打开的专用 Chrome 中登录淘宝。
- 脚本不读取、不导出 Cookie。
- 脚本不绕过验证码或安全验证；出现验证时需要在专用 Chrome 中人工完成。
- 多任务并发数量越高，浏览器资源占用和触发平台安全验证的概率通常越高。
