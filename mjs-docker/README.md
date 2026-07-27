# Docker 部署

该目录将 HTTP API、Playwright 和 Chromium 构建到同一个镜像。运行时不连接用户电脑、不连接用户电脑的 Chrome，也不读取用户电脑的浏览器 Profile。

容器内组件：

```text
Node HTTP API
Playwright 1.62.0
Chromium
/data/chrome-profile 持久化账号数据
```

商品 JSON 与默认 MJS 保持一致：

```text
shopInfo -> spuInfo -> skuInfo -> detailPageInfo
```

## 要求

- Linux 服务器
- Docker Engine 24 或更高版本
- Docker Compose v2
- 至少 2 核 CPU、4 GB 内存、20 GB 可用磁盘

## 启动

在仓库根目录执行：

```bash
cd mjs-docker
cp .env.example .env
docker compose up -d --build
```

查看状态和日志：

```bash
docker compose ps
docker compose logs -f api
```

健康检查：

```bash
curl -sS http://127.0.0.1:3210/health
```

正常结果：

```json
{
  "status": "ok",
  "service": "taobao-tmall-parser",
  "browserMode": "managed"
}
```

## 最简单的扫码登录

服务器已绑定域名和 HTTPS 时，直接在浏览器打开：

```text
https://你的域名/login
```

页面会自动显示淘宝二维码并检查扫码结果，不需要手动调用其他登录接口。扫码成功后，登录状态自动持久化。

域名反向代理配置可使用仓库中的 `http-api/nginx-taobao-parser.conf.example`，将上游地址保持为 `http://127.0.0.1:3210`。

尚未配置域名时，容器默认只映射服务器的 `127.0.0.1`。从管理电脑建立 SSH 转发：

```bash
ssh -L 3210:127.0.0.1:3210 user@server.example.com
```

在管理电脑浏览器直接打开：

```text
http://127.0.0.1:3210/login
```

页面会直接显示淘宝登录二维码并自动轮询状态。使用手机淘宝扫码后，Cookie 自动持久化到 Docker Volume：

```text
taobao-tmall-parser-profile
```

关闭或重建容器不会删除该 Volume，账号状态会继续使用。接口不会返回原始 Cookie。

查询登录状态：

```bash
curl -sS http://127.0.0.1:3210/login/status
```

## 解析商品

```bash
curl -sS \
  --request POST \
  http://127.0.0.1:3210/parse \
  --header 'Content-Type: application/json' \
  --data '{"itemId":"901024796701"}'
```

保存结果：

```bash
curl -sS \
  --request POST \
  http://127.0.0.1:3210/parse \
  --header 'Content-Type: application/json' \
  --data '{"itemId":"901024796701"}' \
  --output item-901024796701.json
```

## 退出账号

```bash
curl -sS --request POST http://127.0.0.1:3210/logout
```

退出后重新打开 `/login` 扫码即可更换账号。

## 停止与重启

```bash
docker compose restart api
docker compose stop
docker compose start
```

停止并删除容器但保留账号 Profile：

```bash
docker compose down
```

不要使用 `docker compose down -v`，该命令会删除保存淘宝 Cookie 的 Volume。

## 更新

```bash
git pull
cd mjs-docker
docker compose up -d --build
```

更新镜像不会删除命名 Volume。

## 备份 Profile

```bash
docker run --rm \
  --volume taobao-tmall-parser-profile:/data:ro \
  --volume "$PWD:/backup" \
  alpine \
  tar -czf /backup/profile-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

备份文件包含账号 Cookie，必须按敏感凭据保护，不得提交 GitHub 或发送给其他人。

## 修改端口

编辑 `.env`：

```text
HOST_PORT=3211
```

重新创建容器：

```bash
docker compose up -d
```

对应访问地址改为 `http://127.0.0.1:3211`。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| Chromium Profile | Volume `taobao-tmall-parser-profile` |
| API 与 MJS | 镜像 `/app` |
| 容器内 Profile | `/data/chrome-profile` |
| Compose 配置 | `mjs-docker/compose.yaml` |

## 安全边界

本项目按要求不使用 API Token。Compose 默认只绑定服务器 `127.0.0.1`，不要把端口映射改成 `0.0.0.0:3210:3210` 后直接暴露公网。

推荐通过 SSH 转发或私有 VPN 使用。需要反向代理时，应配置来源 IP 白名单，并保持 `/login`、`/logout` 和 `/parse` 不对匿名公网开放。

容器以非 root 用户 `pwuser` 运行 Chromium，并使用 Playwright 官方 seccomp 配置允许浏览器沙箱所需的用户命名空间系统调用。

## 故障排查

查看容器状态：

```bash
docker compose ps
docker inspect --format='{{json .State.Health}}' taobao-tmall-parser-api-1
```

查看最近日志：

```bash
docker compose logs --tail=200 api
```

常见情况：

| 现象 | 处理 |
| --- | --- |
| `/health` 不通 | 检查容器和端口映射 |
| `/login` 返回 502 | 检查服务器网络能否访问淘宝 |
| 二维码不显示 | 刷新 `/login`，查看容器日志 |
| 登录后又失效 | 淘宝要求重新验证，重新扫码 |
| Chromium 启动失败 | 检查 `shm_size`、seccomp 文件和 Volume 权限 |
| 解析返回 502 | 检查登录状态、商品 ID和淘宝风控页面 |
