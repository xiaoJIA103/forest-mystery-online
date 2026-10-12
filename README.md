# 山林秘境骰子大冒险：双手机联机版

这个目录包含一个 Node.js 服务和联机网页。服务会托管网页，同时通过 WebSocket 同步房间状态。

## 本地运行

```bash
npm install
npm start
```

浏览器打开 `http://localhost:3000`。一部手机创建房间，另一部手机打开同一个地址并输入 5 位房间码。

## 发布到公网

将整个目录部署到支持 Node.js 和 WebSocket 的服务，例如 Render、Railway 或自有服务器：

- Build command：`npm install`
- Start command：`npm start`
- Node.js：18 或更高版本

部署完成后使用平台提供的 HTTPS 地址。两位玩家打开同一个地址，再通过房间码加入同一局。

免费服务可能在一段时间无访问后休眠，首次打开需要等待服务唤醒；需要持续在线时应选择不会休眠的实例。

