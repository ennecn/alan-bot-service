import { createInterface } from 'readline';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Metroid } from './index.js';
import { importSTCardFromPng, importSTCardFromJson } from './importers/st-card.js';
import { importSTWorldInfo, importSTCharacterBook } from './importers/st-world.js';
import type { MetroidMessage, AgentIdentity, AgentMode } from './types.js';

const DATA_DIR = resolve(process.cwd(), 'data');
const CARD_PATH = process.argv[2] || resolve(process.cwd(), 'cards/xiaolin.json');

// === PAD label helpers ===

function padLabel(axis: 'P' | 'A' | 'D', value: number): string {
  if (axis === 'P') {
    if (value > 0.5) return '愉快';
    if (value > 0) return '偏愉快';
    if (value > -0.5) return '偏低落';
    return '低落';
  }
  if (axis === 'A') {
    if (value > 0.5) return '兴奋';
    if (value > 0) return '偏活跃';
    if (value > -0.5) return '偏平静';
    return '低沉';
  }
  // D
  if (value > 0.5) return '自信';
  if (value > 0) return '偏自信';
  if (value > -0.5) return '偏谦逊';
  return '顺从';
}

function padBar(value: number): string {
  const normalized = (value + 1) / 2; // -1..1 → 0..1
  const filled = Math.round(normalized * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function formatPAD(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(2);
}

// === Command handlers ===

type CommandHandler = (args: string, state: CLIState) => Promise<void> | void;

interface CLIState {
  metroid: Metroid;
  agent: AgentIdentity;
  history: MetroidMessage[];
  debug: boolean;
  msgCounter: number;
}

const commands = new Map<string, { handler: CommandHandler; help: string }>();

commands.set('/help', {
  help: '显示所有命令',
  handler: () => {
    console.log('\n可用命令:');
    for (const [name, { help }] of commands) {
      console.log(`  ${name.padEnd(24)} ${help}`);
    }
    console.log();
  },
});

commands.set('/quit', {
  help: '退出',
  handler: (_args, state) => {
    console.log('\n再见！记忆已保存。');
    state.metroid.shutdown();
    process.exit(0);
  },
});

commands.set('/debug', {
  help: '切换调试模式',
  handler: (_args, state) => {
    state.debug = !state.debug;
    console.log(`调试模式: ${state.debug ? '开启' : '关闭'}`);
  },
});

commands.set('/mode', {
  help: '[classic|enhanced] 切换/查看模式',
  handler: (args, state) => {
    if (args === 'classic' || args === 'enhanced') {
      state.metroid.setAgentMode(state.agent.id, args as AgentMode);
      state.agent = state.metroid.getAgent(state.agent.id)!;
      console.log(`模式已切换为: ${args}`);
    } else {
      console.log(`当前模式: ${state.agent.mode}`);
      console.log('用法: /mode classic 或 /mode enhanced');
    }
  },
});

commands.set('/emotion', {
  help: '显示当前情绪状态 (PAD)',
  handler: (_args, state) => {
    const es = state.metroid.getEmotionState(state.agent.id);
    if (!es) { console.log('无情绪数据'); return; }
    console.log('\n情绪状态 (PAD模型):');
    console.log(`  愉悦度 (P): ${formatPAD(es.pleasure)}  ${padBar(es.pleasure)}  [${padLabel('P', es.pleasure)}]`);
    console.log(`  激活度 (A): ${formatPAD(es.arousal)}  ${padBar(es.arousal)}  [${padLabel('A', es.arousal)}]`);
    console.log(`  支配度 (D): ${formatPAD(es.dominance)}  ${padBar(es.dominance)}  [${padLabel('D', es.dominance)}]`);
    const baseline = state.agent.card.emotion?.baseline;
    if (baseline) {
      console.log(`  基线: P:${formatPAD(baseline.pleasure)} A:${formatPAD(baseline.arousal)} D:${formatPAD(baseline.dominance)}`);
    }
    console.log();
  },
});

commands.set('/memories', {
  help: '[limit] 显示最近记忆 (默认10)',
  handler: (args, state) => {
    const limit = parseInt(args) || 10;
    const memories = state.metroid.getRecentMemories(state.agent.id, limit);
    if (memories.length === 0) { console.log('暂无记忆'); return; }
    console.log(`\n最近 ${memories.length} 条记忆:`);
    for (const m of memories) {
      const age = formatAge(m.createdAt);
      const conf = Math.round(m.confidence * 100);
      console.log(`  [${m.type}] ${m.summary || m.content.slice(0, 80)} (${age}, 置信:${conf}%)`);
    }
    console.log();
  },
});

commands.set('/growth', {
  help: '显示活跃的行为变化',
  handler: (_args, state) => {
    const changes = state.metroid.getActiveGrowthChanges(state.agent.id);
    if (changes.length === 0) { console.log('暂无行为变化'); return; }
    console.log(`\n活跃行为变化 (${changes.length}条):`);
    for (const c of changes) {
      const conf = Math.round(c.confidence * 100);
      console.log(`  - ${c.adaptation} (置信:${conf}%, ${formatAge(c.createdAt)})`);
      console.log(`    观察: ${c.observation}`);
    }
    console.log();
  },
});

commands.set('/agents', {
  help: '列出所有 agent',
  handler: (_args, state) => {
    const agents = state.metroid.getAllAgents();
    console.log(`\n共 ${agents.length} 个 Agent:`);
    for (const a of agents) {
      const current = a.id === state.agent.id ? ' ← 当前' : '';
      console.log(`  ${a.name} (${a.id}) [${a.mode}]${current}`);
    }
    console.log();
  },
});

commands.set('/world', {
  help: '[keyword] 搜索世界书条目',
  handler: (args, state) => {
    if (!args) { console.log('用法: /world <关键词>'); return; }
    const results = state.metroid.searchWorldEntries(args);
    if (results.length === 0) { console.log(`未找到包含 "${args}" 的条目`); return; }
    console.log(`\n找到 ${results.length} 条匹配:`);
    for (const r of results) {
      console.log(`  [${r.keywords.join(', ')}] (优先级:${r.priority})`);
      console.log(`    ${r.content.slice(0, 100)}${r.content.length > 100 ? '...' : ''}`);
    }
    console.log();
  },
});

commands.set('/import', {
  help: '<file> 导入 ST 角色卡(.png/.json)或世界书(.json)',
  handler: (args, state) => {
    if (!args) { console.log('用法: /import <文件路径>'); return; }
    const filePath = resolve(args);
    if (!existsSync(filePath)) { console.log(`文件不存在: ${filePath}`); return; }

    try {
      if (filePath.endsWith('.png')) {
        const result = importSTCardFromPng(filePath);
        console.log(`已导入角色卡: ${result.card.name}`);
        if (result.warnings.length) result.warnings.forEach(w => console.log(`  ⚠ ${w}`));
      } else if (filePath.endsWith('.json')) {
        // Try world info first, then card
        const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (raw.entries) {
          const { getDb } = require('./db/index.js');
          const db = getDb({ dataDir: DATA_DIR, dbPath: resolve(DATA_DIR, 'metroid.db') });
          const result = importSTWorldInfo(filePath, db, state.agent.card.name);
          console.log(`已导入世界书: ${result.entriesImported} 条, 跳过 ${result.entriesSkipped} 条`);
        } else {
          const result = importSTCardFromJson(filePath);
          console.log(`已导入角色卡: ${result.card.name}`);
        }
      } else {
        console.log('不支持的文件格式 (支持 .png 和 .json)');
      }
    } catch (err: any) {
      console.log(`导入失败: ${err.message}`);
    }
  },
});

function formatAge(date: Date): string {
  const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  if (hours < 1) return '刚才';
  if (hours < 24) return `${Math.round(hours)}小时前`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}天前`;
  return `${Math.round(days / 7)}周前`;
}

function statusLine(state: CLIState): string {
  const agent = state.metroid.getAgent(state.agent.id);
  if (!agent) return '';
  if (agent.mode === 'classic') return '\x1b[90m[classic]\x1b[0m';

  const es = state.metroid.getEmotionState(state.agent.id);
  const p = es ? formatPAD(es.pleasure) : '0';
  const a = es ? formatPAD(es.arousal) : '0';
  const d = es ? formatPAD(es.dominance) : '0';
  const memories = state.metroid.getRecentMemories(state.agent.id, 100).length;
  const growth = state.metroid.getActiveGrowthChanges(state.agent.id).length;
  return `\x1b[90m[enhanced | P:${p} A:${a} D:${d} | 记忆:${memories} | 成长:${growth}]\x1b[0m`;
}

// === Main ===

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('请设置 ANTHROPIC_API_KEY 环境变量');
    process.exit(1);
  }

  if (!existsSync(CARD_PATH)) {
    console.error(`找不到角色卡: ${CARD_PATH}`);
    process.exit(1);
  }

  // Load card (support both JSON and PNG)
  let card;
  if (CARD_PATH.endsWith('.png')) {
    const result = importSTCardFromPng(CARD_PATH);
    card = result.card;
  } else {
    card = JSON.parse(readFileSync(CARD_PATH, 'utf-8'));
  }

  console.log('='.repeat(50));
  console.log('  Metroid CLI v0.2');
  console.log(`  角色: ${card.name}`);
  console.log(`  数据: ${DATA_DIR}`);
  console.log('='.repeat(50));
  console.log('输入 /help 查看所有命令');
  console.log();

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

  let agents = metroid.getAllAgents();
  let agent = agents.find(a => a.name === card.name);

  if (agent) {
    console.log(`已加载: ${agent.name} (${agent.id}) [${agent.mode}]`);
  } else {
    agent = metroid.createAgent(card.name, card);
    console.log(`已创建: ${agent.name} (${agent.id}) [${agent.mode}]`);
  }

  metroid.start(agent.id);

  if (card.firstMes) {
    console.log(`\n${card.name}: ${card.firstMes}\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const state: CLIState = {
    metroid, agent, history: [], debug: false, msgCounter: 0,
  };

  const prompt = () => rl.question('你: ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) { prompt(); return; }

    // Command dispatch
    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmdName = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
      const cmdArgs = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';
      const cmd = commands.get(cmdName);
      if (cmd) {
        await cmd.handler(cmdArgs, state);
      } else {
        console.log(`未知命令: ${cmdName}，输入 /help 查看所有命令`);
      }
      prompt();
      return;
    }

    // Chat
    const userMsg: MetroidMessage = {
      id: `msg-${++state.msgCounter}`,
      channel: 'web-im',
      author: { id: 'user-cli', name: '用户', isBot: false },
      content: trimmed,
      timestamp: Date.now(),
    };

    try {
      if (state.debug) console.log('[DEBUG] 发送中...');
      const response = await metroid.chat(state.agent.id, userMsg, state.history);

      state.history.push(userMsg);
      state.history.push({
        id: `msg-${++state.msgCounter}`,
        channel: 'web-im',
        author: { id: state.agent.id, name: state.agent.name, isBot: true },
        content: response,
        timestamp: Date.now(),
      });

      if (state.history.length > 20) {
        state.history.splice(0, state.history.length - 20);
      }

      // Refresh agent state (emotion may have changed)
      state.agent = metroid.getAgent(state.agent.id)!;

      console.log(`\n${card.name}: ${response}`);
      console.log(statusLine(state));
      console.log();
    } catch (err: any) {
      console.error(`\n[错误] ${err.message}\n`);
      if (state.debug) console.error(err);
    }

    prompt();
  });

  prompt();
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
