# Optional Session Authentication — 技术方案

## 问题

当前 session URL（`https://msclaude.ai/xxxxxx`）本身就是凭证，拿到 URL 就能连。对于安全敏感场景需要额外验证。

## 实现思路

### 1. Agent 启动时可选设置密码

`agentlink-client start --password mypass` 或配置文件里设 `password` 字段。Agent 注册时把密码哈希（bcrypt）发给服务端，服务端存在 session 元数据里。

### 2. Web client 连接流程改造

- 浏览器打开 session URL
- 服务端检查该 session 是否设了密码
- **有密码：** WebSocket 握手成功后，不立即发 `connected`，而是发 `{ type: 'auth_required' }`。前端显示密码输入框。用户输入密码，发 `{ type: 'auth', password: '...' }`。服务端用 bcrypt compare 校验，通过则发 `connected` + sessionKey，失败则发 `auth_failed` 并断开。
- **无密码：** 走现有流程，直接发 `connected`。

### 3. 记住认证状态

认证通过后，服务端发一个短期 token（JWT，比如 24 小时过期），前端存 localStorage。下次连接（包括断线重连）带上这个 token，免重新输入密码。

### 4. 暴力破解防护

服务端对同一 sessionId 的认证失败做计数，超过 5 次锁定 15 分钟。

## 总结

核心就是在现有 WebSocket 握手和加密密钥交换之间插入一个认证步骤。完全可选，不设密码则行为不变。
