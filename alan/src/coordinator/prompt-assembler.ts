/**
 * Prompt Assembler — 4-layer prompt construction for System 2.
 * PRD v6.0 §3.3
 *
 * Token estimation: string.length / 4 (Phase 0 approximation).
 */

import type { WIEntry } from '../types/actions.js';
import type { DepthInjection } from '../preset-import/types.js';

export const LITERARY_BASE: Record<'zh' | 'en' | 'ja', string> = {
  zh: `【写作质量要求】
- 展示而非叙述(show don't tell)——用行为、感官、细节传达情绪，不要直接说"她很开心"
- 禁止形容词堆砌——每个名词最多一个修饰语
- 禁止颜文字、emoji、网络用语、括号动作(*动作*)
- 对话要自然口语化，但叙述部分要有文学质感
- 用具体感官细节(气味、温度、质感)代替抽象描写
- 克制比夸张更有力——不要每句话都带感叹号`,
  en: `[Writing Quality]
- Show don't tell — convey emotions through behavior, senses, detail
- No adjective stacking — one modifier per noun maximum
- No emoji, no asterisk actions, no internet slang
- Dialogue should sound natural; narration should have literary quality
- Use concrete sensory details (smell, temperature, texture) over abstractions
- Restraint over exaggeration — not every sentence needs an exclamation mark`,
  ja: `【文章品質】
- 語りではなく描写(show don't tell)——行動・感覚・ディテールで感情を伝える
- 形容詞の積み重ね禁止——名詞に対して修飾語は一つまで
- 絵文字・顔文字・ネットスラング・*アクション*禁止
- 台詞は自然な口語で、地の文は文学的な質感を持たせる
- 具体的な感覚描写(匂い・温度・質感)で抽象表現を置き換える
- 抑制は誇張より力強い`,
};

const FRAMING_TAG: Record<'zh' | 'en' | 'ja', string> = {
  zh: '[角色内心状态——写作参考，不要直接写出]',
  en: '[Character inner state — writing reference, do not quote directly]',
  ja: '[キャラクターの内面状態——執筆参考、そのまま書かないこと]',
};

export const ENDING_RULES: Record<'zh' | 'en' | 'ja', string> = {
  zh: `## 结尾规则
用角色的一个具体动作或未完成的台词结束。
绝对不要以下列方式结尾：
- 总结（"这个夜晚……"/"有什么改变了……"）
- 反思（角色的顿悟/领悟）
- 等待（"等待着回应"）
- 情绪升级（"心中涌起……"）
用户必须感到："接下来发生什么，由我决定。"`,
  en: `## Ending Rule
End with a character's concrete action or unfinished dialogue.
NEVER end with:
- Summary ("that night..." / "something had changed...")
- Reflection (character epiphany/realization)
- Waiting ("waiting for a response")
- Emotional escalation ("a feeling welled up...")
The user must feel: "what happens next is my decision."`,
  ja: `## 終わり方のルール
キャラクターの具体的な行動か、未完の台詞で終わる。
絶対に以下で終わらないこと：
- まとめ（「あの夜は……」/「何かが変わった……」）
- 内省（キャラクターの悟り/気づき）
- 待機（「返事を待っている」）
- 感情のエスカレーション（「胸の奥から……」）
ユーザーに「次に何が起きるかは自分が決める」と感じさせる。`,
};

/** Check if existing PHI already contains ending-related rules */
function hasExistingEndingRules(phi: string): boolean {
  const patterns = ['ending rule', 'end with', '结尾规则', '结尾格式', '结束时必须', '終わり方のルール'];
  const lower = phi.toLowerCase();
  return patterns.some(p => lower.includes(p));
}

/** Sampling preset lookup (PRD §2.3.1) */
export const SAMPLING_PRESETS: Record<string, import('../coordinator/system2/types.js').SamplerParams> = {
  balanced:   { temperature: 0.9, top_p: 0.85, frequency_penalty: 0.3, presence_penalty: 0.25 },
  creative:   { temperature: 1.2, top_p: 0.9, frequency_penalty: 0.15, presence_penalty: 0.1 },
  controlled: { temperature: 0.7, top_p: 0.8, frequency_penalty: 0.4, presence_penalty: 0.35 },
};

export interface AssemblyParams {
  systemPrompt: string;
  soulMd: string;
  mesExample: string;
  constantWI: WIEntry[];
  impulseMd: string;
  emotionNarrative: string;
  activatedWI: WIEntry[];
  chatHistory: Array<{ role: string; content: string }>;
  postHistoryInstructions: string;
  maxContextTokens?: number;
  outputReserve?: number;
  presetSystemPrefix?: string;
  presetPostHistory?: string;
  depthInjections?: DepthInjection[];
  assistantPrefill?: string;
  writingDirective?: string;
  outputStyle?: 'default' | 'casual';
  language?: 'zh' | 'en' | 'ja';
  /** Guard text for L1 injection (Phase 1) */
  guardText?: string;
  /** Banned word text for L1 injection (Phase 1) */
  bannedWordText?: string;
  /** Post-processor reinforcement for L3 injection (Phase 2) */
  reinforcement?: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Token budget defaults
const L1_BUDGET = 4_000;
const PRESET_BUDGET = 4_000;
const L2_BUDGET = 8_000;
const L3_BUDGET_MIN = 8_000;
const L3_BUDGET_MAX = 16_000;
const OUTPUT_RESERVE = 4_000;
const MES_EXAMPLE_LIMIT = 3_000;
const DEFAULT_MAX_CONTEXT = 128_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

/**
 * Truncate mes_example: keep first N complete <START> blocks within token limit.
 */
function truncateMesExample(mesExample: string, maxTokens: number): string {
  if (!mesExample) return '';
  const blocks = mesExample.split('<START>');
  const kept: string[] = [];
  let tokens = 0;

  for (const block of blocks) {
    if (!block.trim()) continue;
    const candidate = '<START>' + block;
    const blockTokens = estimateTokens(candidate);
    if (tokens + blockTokens > maxTokens) break;
    kept.push(candidate);
    tokens += blockTokens;
  }

  return kept.join('');
}

function formatWIEntries(entries: WIEntry[]): string {
  if (entries.length === 0) return '';
  return entries.map((e) => `[WI: ${e.keys.join(', ')}]\n${e.content}`).join('\n\n');
}

export function assemble(params: AssemblyParams): { system: string; messages: AnthropicMessage[] } {
  const maxContext = params.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  const outputReserve = params.outputReserve ?? OUTPUT_RESERVE;
  const lang = params.language ?? 'zh';

  // Build quality block (L3 prepend)
  let qualityBlock = '';
  if (params.outputStyle !== 'casual') {
    qualityBlock = LITERARY_BASE[lang];
    if (params.writingDirective) {
      qualityBlock += '\n\n' + params.writingDirective;
    }
  }

  // Wrap emotion narrative with framing tag
  let framedNarrative = params.emotionNarrative;
  if (params.emotionNarrative) {
    framedNarrative = `${FRAMING_TAG[lang]}\n${params.emotionNarrative}`;
  }

  // L1: system_prompt + guards + banned words (truncate to budget)
  const l1Parts = [params.systemPrompt, params.guardText, params.bannedWordText].filter(Boolean);
  const l1 = truncateToTokens(l1Parts.join('\n\n'), L1_BUDGET);

  // Preset prefix: style guide blocks between L1 and L2
  const presetPrefix = params.presetSystemPrefix
    ? truncateToTokens(params.presetSystemPrefix, PRESET_BUDGET)
    : '';

  // L2: SOUL.md + mes_example + constant WI
  const mesExTruncated = truncateMesExample(params.mesExample, MES_EXAMPLE_LIMIT);
  const constantWIText = formatWIEntries(params.constantWI);
  const l2Parts = [params.soulMd, mesExTruncated, constantWIText].filter(Boolean);
  const l2 = truncateToTokens(l2Parts.join('\n\n'), L2_BUDGET);

  // L3: quality block + reinforcement + IMPULSE.md + framed emotion narrative + activated WI
  const activatedWIText = formatWIEntries(params.activatedWI);
  const l3Parts = [qualityBlock, params.reinforcement, params.impulseMd, framedNarrative, activatedWIText].filter(Boolean);
  const l3Budget = Math.min(L3_BUDGET_MAX, Math.max(L3_BUDGET_MIN, estimateTokens(l3Parts.join('\n\n'))));
  const l3 = truncateToTokens(l3Parts.join('\n\n'), l3Budget);

  // System prompt = L1 + preset_prefix + L2 + L3
  const system = [l1, presetPrefix, l2, l3].filter(Boolean).join('\n\n---\n\n');

  // L4: chat history + post_history_instructions (remainder budget)
  const usedTokens = estimateTokens(system) + outputReserve;
  const l4Budget = maxContext - usedTokens;

  // Build messages from chat history, newest first, truncate to budget
  const messages: AnthropicMessage[] = [];
  let l4Tokens = 0;

  if (params.postHistoryInstructions) {
    const phiTokens = estimateTokens(params.postHistoryInstructions);
    l4Tokens += phiTokens;
  }

  // Add chat history from oldest to newest, but respect budget
  const historyToInclude: Array<{ role: string; content: string }> = [];
  for (let i = params.chatHistory.length - 1; i >= 0; i--) {
    const msg = params.chatHistory[i];
    const msgTokens = estimateTokens(msg.content);
    if (l4Tokens + msgTokens > l4Budget) break;
    historyToInclude.unshift(msg);
    l4Tokens += msgTokens;
  }

  for (const msg of historyToInclude) {
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    });
  }

  // Depth injections: splice into message history at specified depths
  if (params.depthInjections?.length) {
    const sorted = [...params.depthInjections].sort((a, b) => b.depth - a.depth);
    for (const inj of sorted) {
      const insertIdx = Math.max(0, messages.length - inj.depth);
      messages.splice(insertIdx, 0, {
        role: inj.role === 'assistant' ? 'assistant' : 'user',
        content: inj.content,
      });
    }
  }

  // Ending rules: prepend before card PHI if no conflict (PRD §2.2.3)
  const endingRuleText = (params.outputStyle !== 'casual'
    && params.postHistoryInstructions
    && !hasExistingEndingRules(params.postHistoryInstructions))
    ? ENDING_RULES[lang]
    : '';

  // Merge post_history: ending rules + card PHI (priority), then preset post_history
  const finalPHI = [
    endingRuleText,
    params.postHistoryInstructions,
    params.presetPostHistory,
  ].filter(Boolean).join('\n\n');

  if (finalPHI) {
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      last.content += '\n\n' + finalPHI;
    } else {
      messages.push({ role: 'user', content: finalPHI });
    }
  }

  // Assistant prefill: final assistant message to force continuation
  if (params.assistantPrefill) {
    messages.push({ role: 'assistant', content: params.assistantPrefill });
  }

  return { system, messages };
}
