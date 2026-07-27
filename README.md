# 淘宝/天猫商品解析

项目按职责拆分为两个独立目录：

```text
mjs-parser/   默认 MJS 页面解析库
http-api/     使用独立 MJS 的本机/服务器 Node HTTP API
mjs-docker/   自包含 Chromium 的 Docker 部署
八爪鱼RPA/   零第三方依赖、连接现有 Chrome 的 Python RPA 版本
```

## 默认解析库

入口：[mjs-parser/taobao-tmall-page-parser.mjs](mjs-parser/taobao-tmall-page-parser.mjs)

使用说明：[mjs-parser/README.md](mjs-parser/README.md)

## HTTP API

服务入口：[http-api/server.mjs](http-api/server.mjs)

安装、启动和接口说明：[http-api/README.md](http-api/README.md)

服务器绑定域名后，直接访问 `https://你的域名/login` 扫码登录；登录状态保存在服务器，不依赖本机浏览器。

## Docker

容器部署入口：[mjs-docker/README.md](mjs-docker/README.md)

## 八爪鱼 RPA

Python 入口：[八爪鱼RPA/main.py](八爪鱼RPA/main.py)

CDP 开启、校验和节点配置：[八爪鱼RPA/README.md](八爪鱼RPA/README.md)
