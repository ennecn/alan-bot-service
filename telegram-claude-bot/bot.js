const { Bot } = require('grammy');
const { spawn } = require('child_process');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

// Telegram API 通过 VPS proxy 访问 (Mac Mini 在国内)
// 需要在 /etc/hosts 添加: 138.68.44.141 api.telegram.org

// === Config ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_CHATS = (process.env.ALLOWED_CHATS || '').split(',').filter(Boolean);
const CLAUDE_PATH = process.env.CLAUDE_PATH || '/opt/homebrew/bin/claude';
const PTY_WRAP = join(__dirname, 'pty-wrap.py');
const WORKSPACE = process.env.WORKSPACE || join(__dirname, 'workspace');
const SESSIONS_FILE = join(__dirname, 'sessions.json');
const MAX_TURNS = parseInt(process.env.MAX_TURNS || '10');
const CONCURRENT_LIMIT = parseInt(process.env.CONCURRENT_LIMIT || '3');
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || '200');
const MAX_HISTORY_CHARS = parseInt(process.env.MAX_HISTORY_CHARS || '120000');

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}

// === Session Store (session IDs + conversation history) ===
let sessions = {};
if (existsSync(SESSIONS_FILE)) {
  try { sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')); } catch {}
}

// Migrate old format: string → object
for (const [k, v] of Object.entries(sessions)) {
  if (typeof v === 'string') {
    sessions[k] = { claudeSessionId: v, history: [] };
  }
}

function saveSessions() {
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function getSession(key) {
  if (!sessions[key]) sessions[key] = { claudeSessionId: null, history: [] };
  return sessions[key];
}

function getSessionKey(chatId, threadId) {
  return threadId ? `${chatId}:${threadId}` : `${chatId}:main`;
}

// === Conversation History ===
function buildPromptWithHistory(history, newMessage, userName) {
  if (history.length === 0) return newMessage;

  // Trim history to fit within char limit
  let historyText = '';
  const recent = history.slice(-MAX_HISTORY);
  for (let i = recent.length - 1; i >= 0; i--) {
    const entry = recent[i];
    const line = `[${entry.role}] ${entry.text}\n`;
    if (historyText.length + line.length > MAX_HISTORY_CHARS) break;
    historyText = line + historyText;
  }

  return `<conversation_history>\n${historyText.trim()}\n</conversation_history>\n\n[${userName}] ${newMessage}`;
}

function addToHistory(session, role, text) {
  session.history.push({ role, text: text.slice(0, 8000), ts: Date.now() });
  // Keep only recent messages
  if (session.history.length > MAX_HISTORY) {
    session.history = session.history.slice(-MAX_HISTORY);
  }
}

// === Concurrency Control ===
let activeJobs = 0;
const jobQueue = [];

function tryRunNext() {
  if (jobQueue.length === 0 || activeJobs >= CONCURRENT_LIMIT) return;
  activeJobs++;
  const job = jobQueue.shift();
  job().finally(() => { activeJobs--; tryRunNext(); });
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    jobQueue.push(() => fn().then(resolve, reject));
    tryRunNext();
  });
}

// === Claude Code Runner ===
// Claude Code requires a PTY even in -p mode (hangs without it)
function stripAnsi(str) {
  return str.replace(/\x1b\[[^m]*m|\x1b\][^\x07]*\x07|\x1b\[[\?]?[0-9;]*[a-zA-Z]|\r/g, '');
}

function runClaude(prompt, sessionId) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-turns', String(MAX_TURNS), '--dangerously-skip-permissions'];
    if (sessionId) {
      args.unshift('-r', sessionId);
    }

    console.log(`[${new Date().toISOString()}] Spawning Claude (session=${sessionId?.slice(0,8) || 'new'})`);
    const child = spawn('python3', [PTY_WRAP, CLAUDE_PATH, ...args], {
      cwd: WORKSPACE,
      env: { ...process.env, HOME: process.env.HOME || '/Users/fangjin' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let newSessionId = null;
    let resultText = '';
    let lastAssistantText = '';
    let buffer = '';

    child.stdout.on('data', (data) => {
      const raw = stripAnsi(data.toString());
      buffer += raw;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
            newSessionId = msg.session_id;
          }
          if (msg.type === 'result' && msg.result) {
            resultText = msg.result;
          }
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                lastAssistantText = block.text;
              }
            }
          }
        } catch {}
      }
    });

    child.stderr.on('data', () => {});

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude Code timeout (5 min)'));
    }, 5 * 60 * 1000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      console.log(`[${new Date().toISOString()}] Claude exited code=${code}, result=${!!resultText}, session=${newSessionId?.slice(0,8)}`);
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim());
          if (msg.type === 'result' && msg.result) resultText = msg.result;
          if (msg.session_id) newSessionId = newSessionId || msg.session_id;
        } catch {}
      }
      const output = resultText || lastAssistantText;
      if (output) {
        resolve({ text: output, sessionId: newSessionId });
      } else if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}`));
      } else {
        resolve({ text: '(无输出)', sessionId: newSessionId });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// === Telegram Message Helpers ===
function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  while (text.length > 0) {
    let end = maxLen;
    if (text.length > maxLen) {
      const lastNewline = text.lastIndexOf('\n', maxLen);
      if (lastNewline > maxLen * 0.5) end = lastNewline;
    }
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  return chunks;
}

function extractPrompt(text, botUsername) {
  return text
    .replace(new RegExp(`@${botUsername}`, 'gi'), '')
    .trim();
}

// === Bot Setup ===
const bot = new Bot(BOT_TOKEN);

bot.on('message:text', async (ctx) => {
  const chatId = String(ctx.chat.id);

  if (ALLOWED_CHATS.length > 0 && !ALLOWED_CHATS.includes(chatId)) return;

  const text = ctx.message.text || '';
  const botUsername = ctx.me.username;
  const isGroupChat = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const isMentioned = text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

  if (isGroupChat && !isMentioned && !isReplyToBot) return;

  const prompt = isGroupChat ? extractPrompt(text, botUsername) : text;
  if (!prompt) return;

  const threadId = ctx.message.message_thread_id;
  const sessionKey = getSessionKey(chatId, threadId);
  const session = getSession(sessionKey);
  const userName = ctx.from.first_name || 'User';

  console.log(`[${new Date().toISOString()}] ${userName} (${sessionKey}): ${prompt.slice(0, 100)}`);

  // Build prompt with conversation history
  const fullPrompt = buildPromptWithHistory(session.history, prompt, userName);

  // Add user message to history
  addToHistory(session, userName, prompt);

  const thinking = await ctx.reply('🤔 ...', {
    reply_parameters: { message_id: ctx.message.message_id }
  });

  try {
    const result = await enqueue(() => runClaude(fullPrompt, session.claudeSessionId));

    // Save session + add assistant response to history
    if (result.sessionId) {
      session.claudeSessionId = result.sessionId;
    }
    addToHistory(session, 'Claude', result.text);
    saveSessions();

    await ctx.api.deleteMessage(chatId, thinking.message_id).catch(() => {});

    const chunks = splitMessage(result.text);
    for (let i = 0; i < chunks.length; i++) {
      await ctx.reply(chunks[i], {
        reply_parameters: i === 0 ? { message_id: ctx.message.message_id } : undefined,
        parse_mode: undefined
      });
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
    await ctx.api.deleteMessage(chatId, thinking.message_id).catch(() => {});
    await ctx.reply(`❌ ${err.message}`, {
      reply_parameters: { message_id: ctx.message.message_id }
    });
  }
});

// === Commands ===
bot.command('reset', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const threadId = ctx.message.message_thread_id;
  const sessionKey = getSessionKey(chatId, threadId);
  delete sessions[sessionKey];
  saveSessions();
  await ctx.reply('✅ 会话已重置，对话历史已清空');
});

bot.command('sessions', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const keys = Object.keys(sessions).filter(k => k.startsWith(chatId));
  if (keys.length === 0) {
    await ctx.reply('没有活跃会话');
    return;
  }
  const list = keys.map(k => {
    const s = sessions[k];
    const id = s.claudeSessionId?.slice(0, 8) || 'none';
    const msgs = s.history?.length || 0;
    return `• ${k.split(':')[1]} → ${id}... (${msgs} msgs)`;
  }).join('\n');
  await ctx.reply(`活跃会话:\n${list}`);
});

bot.command('status', async (ctx) => {
  const sessionKey = getSessionKey(String(ctx.chat.id), ctx.message.message_thread_id);
  const session = sessions[sessionKey];
  await ctx.reply(
    `Bot Status:\n` +
    `• Active jobs: ${activeJobs}/${CONCURRENT_LIMIT}\n` +
    `• Queue: ${jobQueue.length}\n` +
    `• Sessions: ${Object.keys(sessions).length}\n` +
    `• Current history: ${session?.history?.length || 0} msgs\n` +
    `• Workspace: ${WORKSPACE}`
  );
});

// === Start ===
bot.start({
  onStart: (info) => {
    console.log(`[${new Date().toISOString()}] Bot @${info.username} started`);
    console.log(`  Allowed chats: ${ALLOWED_CHATS.length ? ALLOWED_CHATS.join(', ') : 'all'}`);
    console.log(`  Claude: python3 pty-wrap.py ${CLAUDE_PATH}`);
    console.log(`  Workspace: ${WORKSPACE}`);
    console.log(`  Max turns: ${MAX_TURNS}`);
    console.log(`  Concurrent limit: ${CONCURRENT_LIMIT}`);
    console.log(`  History: ${MAX_HISTORY} msgs / ${MAX_HISTORY_CHARS} chars`);
  }
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  bot.stop();
  process.exit(0);
});
