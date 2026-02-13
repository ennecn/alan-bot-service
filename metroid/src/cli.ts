import { createInterface } from 'readline';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Metroid } from './index.js';
import type { MetroidMessage, MetroidCard } from './types.js';

const DATA_DIR = resolve(process.cwd(), 'data');
const CARD_PATH = process.argv[2] || resolve(process.cwd(), 'cards/xiaolin.json');

async function main() {
  // Validate API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('请设置 ANTHROPIC_API_KEY 环境变量');
    process.exit(1);
  }

  // Load card
  if (!existsSync(CARD_PATH)) {
    console.error(`找不到角色卡: ${CARD_PATH}`);
    process.exit(1);
  }
  const card: MetroidCard = JSON.parse(readFileSync(CARD_PATH, 'utf-8'));

  console.log('='.repeat(50));
  console.log(`  Metroid CLI — 记忆测试工具`);
  console.log(`  角色: ${card.name}`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log('='.repeat(50));
  console.log('命令: /quit 退出 | /memories 查看记忆 | /debug 切换调试模式');
  console.log();

  // Initialize Metroid
  const metroid = new Metroid({
    dataDir: DATA_DIR,
    dbPath: resolve(DATA_DIR, 'metroid.db'),
    llm: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      mainModel: process.env.METROID_MODEL || 'claude-opus-4-6',
      lightModel: process.env.METROID_LIGHT_MODEL || 'claude-haiku-4-5-20251001',
      maxContextTokens: 200_000,
    },
  });

  // Find or create agent
  let agents = metroid.getAllAgents();
  let agent = agents.find(a => a.name === card.name);

  if (agent) {
    console.log(`已加载现有 Agent: ${agent.name} (${agent.id})`);
  } else {
    agent = metroid.createAgent(card.name, card);
    console.log(`已创建新 Agent: ${agent.name} (${agent.id})`);
  }

  metroid.start(agent.id);

  if (card.firstMes) {
    console.log(`\n${card.name}: ${card.firstMes}\n`);
  }

  // Chat loop
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const history: MetroidMessage[] = [];
  let debug = false;
  let msgCounter = 0;

  const prompt = () => rl.question('你: ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) { prompt(); return; }

    // Commands
    if (trimmed === '/quit') {
      console.log('\n再见！记忆已保存。');
      metroid.shutdown();
      rl.close();
      return;
    }
    if (trimmed === '/debug') {
      debug = !debug;
      console.log(`调试模式: ${debug ? '开启' : '关闭'}`);
      prompt();
      return;
    }
    if (trimmed === '/memories') {
      // TODO: expose memory query through Metroid class
      console.log('[记忆查看功能开发中]');
      prompt();
      return;
    }

    // Build message
    const userMsg: MetroidMessage = {
      id: `msg-${++msgCounter}`,
      channel: 'web-im',
      author: { id: 'user-cli', name: '用户', isBot: false },
      content: trimmed,
      timestamp: Date.now(),
    };

    try {
      if (debug) console.log('[DEBUG] 发送中...');

      const response = await metroid.chat(agent!.id, userMsg, history);

      // Add to history
      history.push(userMsg);
      history.push({
        id: `msg-${++msgCounter}`,
        channel: 'web-im',
        author: { id: agent!.id, name: agent!.name, isBot: true },
        content: response,
        timestamp: Date.now(),
      });

      // Keep history manageable (last 20 messages)
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      console.log(`\n${card.name}: ${response}\n`);
    } catch (err: any) {
      console.error(`\n[错误] ${err.message}\n`);
      if (debug) console.error(err);
    }

    prompt();
  });

  prompt();
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
