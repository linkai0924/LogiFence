# LogiFence 实时辩论辅助系统

面向辩论赛现场的实时攻防辅助工具：对手发言实时转写 → 自动拆解论点/识别逻辑漏洞 → 给出反驳角度、追问与金句，多端浏览器实时同步。

## 功能

- 🎙 对手发言实时语音转写（阿里云百炼 Paraformer 流式 ASR）
- ⚡ 观点拆解：主论点 / 论据 / 隐含假设 / 逻辑漏洞（偷换概念、因果谬误、以偏概全、循环论证等）
- ⚔ 即时攻防提示：反驳角度、追问问题、金句、关联我方论据
- 🛡 我方立场锚定 + 我方发言前后矛盾检测
- 🔖 核心概念高亮，监控对方歪曲定义
- ⏱ 环节计时（预设模板可编辑），服务端权威计时多端同步
- 📱 B/S 架构：手机 / 平板 / 电脑浏览器加入房间即可，模型密钥只在服务端

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填入 DASHSCOPE_API_KEY 和 DEEPSEEK_API_KEY
npm run dev                  # 开发
npm run build && npm start   # 生产
```

环境变量：

| 变量 | 说明 |
|---|---|
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key（语音识别 paraformer-realtime-v2） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（默认 LLM） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 可选，切换任意 OpenAI 兼容模型服务 |
| `PORT` | 默认 3000 |

## 使用流程

1. 首页「创建辩论房间」→ 赛前设置页填写辩题、我方立场、立论要点、核心概念定义、论据库，编辑赛制环节时长。
2. 保存进入面板，把 6 位房间码告诉队友，手机/平板浏览器加入。
3. 指定一人点「成为采集端」，把设备放在能清晰收听到发言的位置，点「开始收音」。
4. 采集员用「对方发言 / 我方发言」大按钮切换说话人（谁在说就切到谁）。
5. 所有设备实时看到：对方论点摘要、漏洞标签、反驳要点、追问、金句；我方发言自动做矛盾检测。
6. 结束后点「导出」下载全场 Markdown 记录。

## 部署（公网）

浏览器麦克风要求安全上下文，公网部署必须 HTTPS。推荐 Caddy 反代：

```
debate.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

`npm run build && PORT=3000 npm start`，配合 pm2/systemd 常驻即可。

## 架构

```
采集端浏览器 (AudioWorklet → PCM 16k) ──WS──> Node 自定义服务器
                                                ├─> DashScope ASR WebSocket（转写）
                                                ├─> DeepSeek（OpenAI 兼容，攻防分析）
                                                └─> 房间广播（同房间所有端）
数据：SQLite（data/logifence.db）存房间设置、转写、分析记录。
```

- `server.ts`：自定义 Node 服务器（Next.js + WebSocket 同进程）
- `src/server/asr.ts`：Paraformer 实时 ASR 客户端
- `src/server/analyzer.ts`：LLM 攻防分析 / 矛盾检测
- `src/server/ws.ts`：房间运行时、说话人切换、权威计时、增量分析调度
- `src/app/room/[code]`：主面板（极简卡片流 + 计时 + 转写/论据抽屉）
