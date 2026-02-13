# Mac Mini OpenClaw 部署指南

## 概述

在 Mac Mini (fangjin@192.168.21.111) 上使用 Docker 部署 OpenClaw 实例，通过 Telegram Bot 提供 AI 对话服务。每个实例独立运行，拥有自己的 Telegram Bot、端口和配置。

## 前置条件

- Mac Mini 已安装 Docker Desktop
- `openclaw:local` Docker 镜像已构建
- NAS 已挂载到 `/tmp/nas`（SMB: `//alin@192.168.21.135/aling`）
- LLM Gateway 运行在 `127.0.0.1:8080`（可选，用于高级路由）
- Antigravity Manager 运行在 `host.docker.internal:8045`（本地，key: `sk-antigravity`）

## 端口分配规则

| 实例 | 容器名 | API Proxy 端口 | Gateway 端口 |
|------|--------|---------------|-------------|
| 阿凛 | deploy-openclaw-gateway-1 | 8022 | 18789 |
| Lain | lain-gateway | 8023 | 18790 |
| 阿澪 | aling-gateway | 8024 | 18791 |
| Lumi | lumi-gateway | 8025 | 18792 |
| 下一个 | xxx-gateway | 8026 | 18793 |

规则：API Proxy = `8022 + N`，Gateway = `18789 + N`（N 从 0 开始）

## 目录结构

```
~/Desktop/p/docker-openclawd/deploy-{name}/
├── docker-compose.yml    # Docker 服务定义
├── .env                  # 环境变量（API_KEY）
├── api-proxy.js          # 容器内 API 代理（bind-mount :ro）
├── start.sh              # 容器启动脚本（bind-mount :ro）
├── anthropic.js          # pi-ai 库覆盖文件（bind-mount :ro）
├── config/               # → 映射到容器 /home/node/.openclaw
│   ├── openclaw.json     # 主配置文件
│   └── skills/           # 技能目录
│       └── image-gen/    # 图片生成技能
│           ├── _meta.json
│           └── SKILL.md
└── workspace/            # → 映射到容器 /home/node/.openclaw/workspace
```

## 部署步骤

### Step 1: 创建部署目录

```bash
BOT_NAME="newbot"  # 改为你的 bot 名称
DEPLOY_DIR=~/Desktop/p/docker-openclawd/deploy-${BOT_NAME}
mkdir -p $DEPLOY_DIR/config/skills/image-gen $DEPLOY_DIR/workspace
```

### Step 2: 从现有实例复制共享文件

```bash
# 这两个文件所有实例通用，直接复制
cp ~/Desktop/p/docker-openclawd/deploy/start.sh $DEPLOY_DIR/
cp ~/Desktop/p/docker-openclawd/deploy/anthropic.js $DEPLOY_DIR/
```

### Step 3: 创建 docker-compose.yml

替换以下变量：
- `CONTAINER_NAME`: 容器名（如 `newbot-gateway`）
- `PROXY_PORT`: API Proxy 外部端口（如 `8026`）
- `GW_PORT`: Gateway 外部端口（如 `18793`）

```yaml
services:
  ${CONTAINER_NAME}:
    image: openclaw:local
    container_name: ${CONTAINER_NAME}
    ports:
      - "${GW_PORT}:18789"
      - "${PROXY_PORT}:8022"
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: ${GATEWAY_TOKEN:-mysecrettoken123}
      OPENCLAW_GATEWAY_PASSWORD: openclaw123
      ANTHROPIC_BASE_URL: http://127.0.0.1:8022
      ANTHROPIC_API_KEY: ${API_KEY}
      DISPLAY: :99
    volumes:
      - ./config:/home/node/.openclaw
      - ./workspace:/home/node/.openclaw/workspace
      - ./api-proxy.js:/home/node/api-proxy.js:ro
      - ./start.sh:/home/node/start.sh:ro
      - ./anthropic.js:/app/node_modules/.pnpm/@mariozechner+pi-ai@0.52.6_ws@8.19.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js:ro
      - /tmp/nas:/mnt/nas
    init: true
    restart: unless-stopped
    entrypoint: ["bash", "/home/node/start.sh"]
```

### Step 4: 创建 .env

```bash
# 如果走 LLM Gateway，需要先在 Gateway Dashboard 创建 Client 获取 API Key
# 如果直接走 v3.codesome.cn，使用 codesome 的 key
echo "API_KEY=你的API_KEY" > $DEPLOY_DIR/.env
echo "GATEWAY_TOKEN=mysecrettoken123" >> $DEPLOY_DIR/.env
```

### Step 5: 创建 api-proxy.js

有两种路由模式可选：

#### 模式 A: 直连 v3.codesome.cn + Antigravity 生图

适用于不需要 LLM Gateway 高级路由的实例（阿凛、阿澪、Lain 使用此模式）。

```javascript
const http = require('http');
const https = require('https');

// Model name mapping
const MODEL_MAP = {
  "anthropic/claude-opus-4-5": "claude-opus-4-5-20251101-thinking",
  "claude-opus-4-5": "claude-opus-4-5-20251101-thinking"
};

// Models that should route to Antigravity (image generation)
const ANTIGRAVITY_MODELS = ['gemini-3-pro-image'];

// Antigravity endpoint (local on Mac Mini)
const ANTIGRAVITY_HOST = 'host.docker.internal';
const ANTIGRAVITY_PORT = 8045;
const ANTIGRAVITY_KEY = 'sk-antigravity';

// Default target - v3.codesome.cn
const TARGET_HOST = 'v3.codesome.cn';
const API_KEY = 'sk-e6f7371f681661a2cf4e14a4cb6bab8b1884b5b09f53cb671312d3caa2a666c8';

function forwardToAntigravity(data, req, res) {
  const targetBody = JSON.stringify(data);
  console.log(`[Proxy] Routing ${data.model} -> Antigravity`);
  const options = {
    hostname: ANTIGRAVITY_HOST, port: ANTIGRAVITY_PORT,
    path: '/v1/messages', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(targetBody),
      'x-api-key': ANTIGRAVITY_KEY,
      'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
    }
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    console.error('[Proxy] Antigravity error:', e);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Antigravity unreachable: ' + e.message }));
  });
  proxyReq.write(targetBody);
  proxyReq.end();
}

function forwardToCodesome(data, req, res) {
  const targetBody = JSON.stringify(data);
  const options = {
    hostname: TARGET_HOST, port: 443,
    path: '/v1/messages', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(targetBody),
      'x-api-key': API_KEY,
      'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
    }
  };
  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    console.error('[Proxy] Error:', e);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  });
  proxyReq.write(targetBody);
  proxyReq.end();
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.model && MODEL_MAP[data.model]) {
          console.log(`[Proxy] Mapping: ${data.model} -> ${MODEL_MAP[data.model]}`);
          data.model = MODEL_MAP[data.model];
        }
        if (data.model && ANTIGRAVITY_MODELS.includes(data.model)) {
          forwardToAntigravity(data, req, res);
        } else {
          forwardToCodesome(data, req, res);
        }
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', target: 'v3.codesome.cn', antigravity: 'host.docker.internal:8045' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8022, '127.0.0.1', () => {
  console.log('[Proxy] Ready on http://127.0.0.1:8022 -> v3.codesome.cn + Antigravity');
});
```

#### 模式 B: 通过 LLM Gateway 路由

适用于需要高级路由（per-client 路由、provider cascade）的实例（Lumi 使用此模式）。

```javascript
const http = require('http');

const GATEWAY_HOST = 'host.docker.internal';
const GATEWAY_PORT = 8080;
const CLIENT_API_KEY = '你的Gateway客户端Key';  // 从 LLM Gateway Dashboard 创建

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const targetBody = JSON.stringify(data);
        const options = {
          hostname: GATEWAY_HOST, port: GATEWAY_PORT,
          path: '/v1/messages', method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(targetBody),
            'x-api-key': CLIENT_API_KEY,
            'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
          }
        };
        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', (e) => {
          res.writeHead(502);
          res.end(JSON.stringify({ error: { type: 'proxy_error', message: e.message } }));
        });
        proxyReq.write(targetBody);
        proxyReq.end();
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', target: 'llm-gateway:8080', client: 'BOT_NAME' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8022, '127.0.0.1', () => {
  console.log('[Proxy] Ready on http://127.0.0.1:8022 -> LLM Gateway');
});
```

### Step 6: 创建 openclaw.json

```json
{
    "meta": {
        "lastTouchedVersion": "2026.2.4",
        "lastTouchedAt": "2026-02-08T00:00:00.000Z"
    },
    "browser": {
        "enabled": true,
        "executablePath": "/home/node/.local/chromium-arm64/chrome-linux/chrome",
        "headless": true,
        "noSandbox": true,
        "defaultProfile": "openclaw"
    },
    "agents": {
        "defaults": {
            "maxConcurrent": 8,
            "subagents": { "maxConcurrent": 8 }
        }
    },
    "tools": {
        "web": {
            "search": { "apiKey": "BSADps1Sr_Xhuvb6ezCOy2knSxelDKT" }
        },
        "elevated": {
            "enabled": true,
            "allowFrom": { "telegram": ["6564284621"] }
        },
        "exec": { "security": "full" }
    },
    "messages": { "ackReactionScope": "group-mentions" },
    "commands": {
        "native": "auto",
        "nativeSkills": "auto",
        "restart": true
    },
    "session": { "dmScope": "per-channel-peer" },
    "channels": {
        "telegram": {
            "enabled": true,
            "dmPolicy": "allowlist",
            "botToken": "替换为你的Telegram Bot Token",
            "groups": { "*": { "requireMention": true } },
            "allowFrom": [
                "6564284621",
                "7566460859",
                "7693254450",
                "7965463725",
                "7796758126",
                "7195652917"
            ],
            "groupPolicy": "open",
            "streamMode": "partial"
        }
    },
    "gateway": {
        "controlUi": { "dangerouslyDisableDeviceAuth": true }
    },
    "plugins": {
        "entries": { "telegram": { "enabled": true } }
    }
}
```

**必须修改的字段：**
- `channels.telegram.botToken` — 替换为新 Bot 的 Token

### Step 7: 安装 image-gen 技能

```bash
# _meta.json
cat > $DEPLOY_DIR/config/skills/image-gen/_meta.json << 'EOF'
{
  "slug": "image-gen",
  "name": "Image Generation",
  "version": "1.0.0"
}
EOF
```

SKILL.md 内容见 `skill-image-gen/SKILL.md`，或从现有实例复制：
```bash
cp ~/Desktop/p/docker-openclawd/deploy/config/skills/image-gen/SKILL.md \
   $DEPLOY_DIR/config/skills/image-gen/
```

### Step 8: 启动实例

```bash
cd $DEPLOY_DIR
/usr/local/bin/docker compose up -d
```

### Step 9: 验证

```bash
CONTAINER="newbot-gateway"  # 替换为你的容器名
DOCKER=/usr/local/bin/docker

# 检查容器运行状态
$DOCKER ps | grep $CONTAINER

# 检查 API Proxy 健康
$DOCKER exec $CONTAINER curl -s http://127.0.0.1:8022/health

# 检查 Proxy 进程
$DOCKER exec $CONTAINER pgrep -f 'api-proxy.js'

# 测试 API 调用
$DOCKER exec $CONTAINER curl -s -m 30 -X POST http://127.0.0.1:8022/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -H 'x-api-key: dummy' \
  -d '{"model":"claude-sonnet-4-5-thinking","messages":[{"role":"user","content":"ping"}],"max_tokens":50}' \
  | head -c 200
```

## 运维操作

### 重启 API Proxy（不重启容器）

api-proxy.js 是 bind-mount `:ro`，更新宿主机文件后：

```bash
CONTAINER="xxx-gateway"
DOCKER=/usr/local/bin/docker
# Kill 旧进程
$DOCKER exec $CONTAINER kill $(docker exec $CONTAINER pgrep -f 'api-proxy.js')
# 等待 1 秒
sleep 1
# 启动新进程
$DOCKER exec -d $CONTAINER node /home/node/api-proxy.js
```

### 查看日志

```bash
/usr/local/bin/docker logs -f --tail 50 xxx-gateway
```

### 停止/删除实例

```bash
cd ~/Desktop/p/docker-openclawd/deploy-xxx
/usr/local/bin/docker compose down
```

## 注意事项

1. **api-proxy.js 是只读挂载** — 不能用 `docker cp` 覆盖，必须修改宿主机文件后重启 proxy 进程
2. **ANTHROPIC_BASE_URL 环境变量无效** — pi-ai 库忽略此变量，必须通过 start.sh 中的 sed 命令 patch `models.generated.js`
3. **openclaw.json 没有 baseUrl 配置** — 只能通过容器内 proxy 拦截请求
4. **Kimi provider 的 supported_models 不能为空** — 空列表 = 接受所有模型，会拦截不该处理的请求
5. **NAS 挂载** — 容器内通过 `/mnt/nas` 访问，宿主机通过 `/tmp/nas` 访问
6. **anthropic.js 路径** — 必须匹配 pi-ai 库的精确版本路径，如果 openclaw 镜像更新需要检查路径是否变化
