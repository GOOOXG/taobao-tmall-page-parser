# Taobao/Tmall Page Parser

使用同一个 Playwright 解析器读取淘宝和天猫新版商品详情页，输出统一 JSON：

```text
shopInfo -> spuInfo -> skuInfo -> detailPageInfo
```

媒体字段顺序：

```text
videoCover -> video -> mainImages
```

视频、参数、尺码、工业文档等可选模块不存在时不会输出空字段。

## 环境

- Node.js 18+
- Playwright 1.40+
- 已登录淘宝的独立 Chrome 调试配置

```powershell
npm install playwright
```

## 使用

```javascript
import { chromium } from "playwright";
import { parseTaobaoTmallPage } from "./taobao-tmall-page-parser.mjs";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9224");
const context = browser.contexts()[0];
const page = await context.newPage();

try {
  await page.goto("https://item.taobao.com/item.htm?id=40995281114", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  await page.waitForFunction(
    () => Boolean(window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res),
    null,
    { timeout: 120000 },
  );

  const result = await parseTaobaoTmallPage(page);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await page.close();
}
```

## API

```javascript
parseTaobaoTmallPage(page)
parseTaobaoPage(page)
parseTmallPage(page)
```

三个入口使用同一套实现并返回同一协议。

## 真实商品示例

示例链接：

```text
https://detail.tmall.com/item.htm?abbucket=20&id=901024796701&mi_id=0000kX7BxrB4CXIxoB7dsZTV_42SCghic-HyHIjbL_poSpo&ns=1&skuId=5922764406788&spm=0.0.hoverItem.3&utparam=%7B%22aplus_abtest%22%3A%2229cfc55bf7b194d31865162b22e13ca2%22%7D&xxc=taobaoSearch
```

该结果由 `taobao-tmall-page-parser.mjs` 直接解析：

```json
{
  "itemId": 901024796701,
  "title": "红袖泡泡袖小清新连衣裙夏季新款女装【醒春集】收腰100%棉碎花裙",
  "shopName": "红袖官方旗舰店",
  "shopId": "66864024",
  "skuCount": 12,
  "media": ["videoCover", "video", "mainImages"],
  "mainImageCount": 5,
  "detailImageCount": 22,
  "currentPriceText": "379",
  "soldText": "已售 2000+"
}
```

完整结构化结果：[examples/item-901024796701.json](examples/item-901024796701.json)

## 安全

不要提交 Chrome 用户配置、Cookie、账号信息或抓取结果。建议使用只登录目标账号的独立 Chrome 配置。
