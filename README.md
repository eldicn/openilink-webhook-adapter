<p align="center">
 <h2 align="center"><em><strong>OpeniLink Webhook Adapter</strong></em></h2>
 <p align="center"><strong>为不支持自定义 Header 的应用提供 Webhook 接入能力，自动注入鉴权 Header 转发至 OpeniLink，支持多目标与失败重试</strong></p>
</p>

---

## 这个项目解决了什么问题？

**问题：** 有些 app 发 webhook 通知时不支持自定义 Header，但 OpeniLink 的发消息接口需要 `Authorization` Header 认证

**解决：** 在中间加一层 adapter，对外暴露一个无需 Header 的接口（token 放 URL query string），收到消息后：

1. 从各种 app 的 payload 里提取文字（兼容 `title/content/text` 等字段）
2. 按 `bodyTemplate` 重新组装成 OpeniLink 要求的格式
3. 注入 `Authorization` Header 转发给 OpeniLink
4. 失败自动重试（指数退避）

**结果：** 任何 app 只需填一个 URL 就能把通知发到 OpeniLink 不需要支持自定义 Header，也不需要了解 OpeniLink 的接口细节。

## 如何使用

克隆本仓库到任意位置，并初始化配置

编辑 `./config/config.json` 填入以下字段

- **secret**: 通过 `openssl rand -hex 32` 生成
- **url** 和 **Authorization**: 详见 OpeniLink 内置应用 Bridge 使用指南

配置完成后，在终端运行以下命令

```bash
docker compose -p openilink-webhook-adapter build --no-cache
docker compose -p openilink-webhook-adapter up -d
```

提供的接口如下

```bash
# 健康检查
curl http://localhost:3000/health

# 发送消息
curl -X POST http://localhost:3000/webhook?token={secret} \
  -H "Content-Type: application/json" \
  -d '{"text":"hello from curl"}'
```

## 内部流程

```bash
收到：{"text": "hello"}        ← app 发来的，字段名无所谓
         ↓ buildMessage 提取
      "hello"                 ← 纯文字
         ↓ renderTemplate 填入
发出：{"content": "hello"}     ← 按 bodyTemplate 格式发给 openilink
```

> 支持 title / content / desc / body / message / text 任意字段，都没有就整个 JSON 兜底