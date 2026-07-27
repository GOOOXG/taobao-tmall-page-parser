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
