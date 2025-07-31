# 跨频道回复拦截机器人

一个运行在 Cloudflare Workers 上的轻量级 Telegram 机器人，能够在具有管理员权限的群组中自动删除跨频道回复消息。

## 功能特性

- 🚫 **自动跨频道回复拦截**：即时删除回复外部频道内容的消息
- 🔗 **智能频道检测**：区分关联频道（允许）和外部频道（拦截）
- ⚠️ **用户友好警告**：发送临时警告消息，10秒后自动删除
- 🌍 **Cloudflare Workers**：无服务器部署，全球边缘节点
- 🎯 **最小权限要求**：仅需基本的消息管理权限
- 📝 **编辑消息支持**：同时处理编辑后变成跨频道回复的消息

## 工作原理

机器人通过以下几种方法识别跨频道回复：

1. **外部回复**：频道直接回复到群组的消息
2. **转发消息回复**：回复从频道转发的消息
3. **频道发送回复**：回复由频道在群组中发送的消息
4. **隐藏转发回复**：回复来源隐藏的转发消息
5. **签名回复**：回复带有频道签名的消息

### 关联频道 vs 外部频道

- **关联频道**：与群组正式关联的频道（允许）
- **外部频道**：第三方频道（拦截）

## 部署指南

### 前提条件

1. 从 [@BotFather](https://t.me/BotFather) 获取的 Telegram 机器人 Token
2. Cloudflare 账户
3. 已安装 Node.js 和 npm

### 部署步骤

1. **准备代码**：
   - 复制 `worker.js` 的所有内容到剪贴板

2. **登录 Cloudflare Dashboard**：
   - 访问 [https://dash.cloudflare.com](https://dash.cloudflare.com)
   - 使用你的 Cloudflare 账户登录

3. **创建新的 Worker**：
   - 在左侧导航栏中找到并点击 "Workers & Pages"
   - 点击右上角的 "Create application" 按钮
   - 选择 "Create Worker" 选项
   - 在名称字段输入有意义的名称，如：`telegram-channel-blocker`
   - 点击 "Deploy" 按钮（此时会创建一个默认的 Worker）

4. **编辑 Worker 代码**：
   - 部署完成后，你会看到 Worker 的概览页面
   - 点击 "Edit code" 按钮进入代码编辑器
   - **重要**：选中并删除编辑器中的所有默认代码
   - 粘贴从 `worker.js` 复制的完整代码
   - 点击右上角的 "Save and deploy" 按钮

5. **设置环境变量**：
   - 返回 Worker 概览页面，点击 "Settings" 标签
   - 在页面中找到 "Environment Variables" 部分
   - 点击 "Add variable" 按钮
   - 填写环境变量：
     - **Variable name**: `BOT_TOKEN`
     - **Value**: 你从 @BotFather 获得的完整机器人 Token（格式如：`123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`）
     - **勾选 "Encrypt"** 选项以确保 Token 安全
   - 点击 "Save and deploy" 保存

6. **获取 Worker URL**：
   - 回到 Worker 概览页面
   - 复制显示的 Worker URL（格式如：`https://你的worker名称.你的用户名.workers.dev`）

7. **配置 Telegram Webhook**：
   - 在浏览器中访问：`你的Worker URL/setup`
   - 例如：`https://telegram-channel-blocker.yourname.workers.dev/setup`
   - 如果配置成功，你会看到类似 "Webhook set successfully" 的成功消息

8. **验证部署**：
   - 访问 `你的Worker URL/health` 检查健康状态
   - 如果返回包含 "healthy" 的 JSON 响应，说明部署成功

9. **将机器人添加到群组**：
   - 在 Telegram 中找到你的机器人
   - 将机器人添加到目标群组
   - **关键步骤**：将机器人设为管理员，并确保勾选以下权限：
     - ✅ "Delete messages"（删除消息）
     - ✅ "Send messages"（发送消息）
   - 机器人立即开始监控和拦截跨频道回复

### 获取 Telegram Bot Token 详细步骤

1. **创建机器人**：
   - 在 Telegram 中搜索并启动 [@BotFather](https://t.me/BotFather)
   - 发送 `/newbot` 命令
   - 按提示输入机器人名称和用户名

2. **获取 Token**：
   - 创建成功后，BotFather 会发送包含 Token 的消息
   - Token 格式：`123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
   - **重要**：妥善保管这个 Token，不要泄露给他人

3. **配置机器人**：
   - 发送 `/setprivacy` 设置隐私模式为 Disabled（可选）
   - 发送 `/setjoingroups` 允许机器人加入群组
   - 发送 `/setcommands` 可设置机器人命令菜单（可选）

## 机器人命令

机器人自动工作，不需要任何命令。只需将其添加到具有适当权限的群组中即可。

## API 端点

- `GET /health` - 健康检查端点
- `POST /webhook` - Telegram webhook 端点（自动配置）
- `GET /setup` - 设置 webhook 配置

## 自定义配置

可以通过修改 `worker.js` 中的以下设置来自定义机器人行为：

- **警告消息文本**：修改 `CONFIG.WARNING_MESSAGE_TEXT` 常量
- **自动删除超时**：修改 `CONFIG.WARNING_AUTO_DELETE_DELAY` 常量
- **允许的更新类型**：调整 webhook 设置中的 `allowed_updates`
- **重试次数**：修改 `CONFIG.MAX_RETRIES` 常量
- **请求超时**：修改 `CONFIG.REQUEST_TIMEOUT` 常量

## 所需权限

机器人在你的群组中需要以下 Telegram 权限：

- ✅ **删除消息**：用于移除跨频道回复
- ✅ **发送消息**：用于发送警告通知

## 使用限制

- 仅在群组和超级群组中工作（不支持私聊）
- 需要管理员权限才能删除消息
- 警告消息使用 10 秒超时（为用户体验优化）
- 单个 Worker 实例的内存缓存限制

## 隐私保护

此机器人：
- ✅ 仅处理具有管理员权限的群组中的消息
- ✅ 不存储任何用户数据或消息内容
- ✅ 不记录个人信息
- ✅ 完全在 Cloudflare 边缘网络上运行
- ✅ 使用内存缓存，重启后自动清理

## 开发调试

### 本地开发

```bash
npm run dev
```

### 测试

要在本地测试机器人，可以使用 ngrok 等工具暴露本地开发服务器：

```bash
ngrok http 8787
# 在开发期间使用 ngrok URL 进行 webhook 设置
```

### 查看日志

1. **Cloudflare Dashboard 日志**：
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
   - 进入你的 Worker
   - 点击 "Logs" 标签查看实时日志

2. **Wrangler 本地日志**：
   ```bash
   npx wrangler tail
   ```

## 故障排除

### 常见问题

1. **机器人无响应**：
   - 检查 webhook 是否通过 `/setup` 端点正确设置
   - 确认 BOT_TOKEN 环境变量设置正确
   - 查看 Worker 日志中的错误信息

2. **消息未被删除**：
   - 确保机器人具有"删除消息"的管理员权限
   - 检查机器人是否正确识别了跨频道回复
   - 确认群组类型为 group 或 supergroup

3. **警告消息未出现**：
   - 检查机器人是否有"发送消息"权限
   - 确认警告消息配置正确
   - 查看是否被其他管理员删除

4. **频繁的 API 错误**：
   - 检查是否触发了 Telegram API 速率限制
   - 机器人会自动重试，等待片刻即可恢复

### 调试信息

在 Cloudflare Workers 控制台中检查详细的错误信息和处理日志：

1. 访问 [https://dash.cloudflare.com](https://dash.cloudflare.com)
2. 进入 Workers & Pages
3. 选择你的 Worker
4. 查看 "Logs" 标签获取实时日志
5. 查看 "Metrics" 标签监控性能

### 性能监控

- **请求数量**：正常情况下应该与群组消息数量相符
- **错误率**：应该保持在较低水平（< 1%）
- **响应时间**：通常在 100-500ms 之间
- **内存使用**：缓存会占用少量内存，重启后清理

## 开源协议

MIT 许可证 - 可自由修改和分发。

## 技术支持

如有问题和功能请求，请查看 Cloudflare Workers 控制台中的机器人日志获取详细信息。

## 版本更新

当前版本：**v1.0.0**
