# 淘宝/天猫商品解析

项目按职责拆分为两个独立目录：

```text
mjs-parser/   默认 MJS 页面解析库
http-api/     调用 MJS 的本地 Node HTTP API
```

## 默认解析库

入口：[mjs-parser/taobao-tmall-page-parser.mjs](mjs-parser/taobao-tmall-page-parser.mjs)

使用说明：[mjs-parser/README.md](mjs-parser/README.md)

## HTTP API

服务入口：[http-api/server.mjs](http-api/server.mjs)

安装、启动和接口说明：[http-api/README.md](http-api/README.md)
