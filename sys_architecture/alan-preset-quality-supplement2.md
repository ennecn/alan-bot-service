 Context

  Problem: In a fair ST vs Alan comparison test (using Zero preset with full prompt assembly), ST beat Alan 4-1. Root cause: Alan has zero writing quality instructions — its system_prompt is 90 tokens of basic personality, while Zero preset has 5000+ chars of detailed
  writing rules (200+ banned cliché words, show-don't-tell, cinematic style, anti-adjective-stacking, POV, dialogue style, NPC naming, etc.).

  Previous 5-0 Alan win was invalid: ChatBridge bypasses ST's entire preset system, giving ST a bare-bones prompt (~300 chars, zero writing rules). That comparison measured "anything vs nothing."

  Rejected approach: Adding a static STYLE.md file — user explicitly rejected this, citing the earlier decision to reduce from 6 md files to 1. Static style rules also waste Alan's key differentiator (dynamic emotion tracking).

  Approved approach: Expand the Narrativizer to generate emotion-aware writing directives — dynamic writing technique instructions that adapt to each scene's emotional context. This turns emotion tracking from a label generator into a genuine competitive advantage over
  static presets.

  Design

  Part 1: writeDirective() — Emotion-to-Writing-Technique Mapping

  File: src/emotion/narrativizer.ts (expand existing file)

  The existing file exports narrativize(state, language, customTemplates?) which converts EmotionState (6D: joy/sadness/anger/anxiety/longing/trust, each 0.0–1.0) into natural language describing what the character feels.

  Add a new export writeDirective(state: EmotionState, language: Language): string that maps the current emotion pattern to specific writing technique instructions for S2.

  The key insight: different emotional states demand different literary techniques. High sadness calls for sparse, fragmentary prose. High joy calls for flowing sensory detail. Mixed emotions call for subtext and contrast. This is something a static preset can never do.

  Types used (already defined in src/types/index.ts):
  type EmotionDimension = 'joy' | 'sadness' | 'anger' | 'anxiety' | 'longing' | 'trust';
  type EmotionState = Record<EmotionDimension, number>; // each 0.0–1.0

  Emotion Pattern → Writing Technique Map (zh examples, en/ja analogous):

  ┌──────────────────────────────────────────┬────────────────────────────────────────────────────────────────────┐
  │                 Pattern                  │                        Technique Directive                         │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ High sadness (≥0.6)                      │ 用留白和省略传达沉重感。句子要短，节奏要慢。让沉默比语言更有力。   │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ High joy (≥0.6)                          │ 用流动的感官细节和明快的节奏传达愉悦。让环境也跟着角色一起亮起来。 │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ High anger (≥0.6)                        │ 用短促、有力的句子。动作描写优先于心理描写。克制比爆发更有张力。   │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ High anxiety (≥0.6)                      │ 用碎片化的思维和敏锐的感官捕捉不安感。注意力在细节间快速跳跃。     │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ High longing (≥0.6)                      │ 用回忆与现实的交错营造距离感。感官记忆比直白的思念更有力。         │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ High trust (≥0.8) + joy (≥0.4)           │ 语言松弛自然。对话多于描写。用小动作和口头禅传达亲近感。           │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ Mixed conflict (anger+sadness both ≥0.5) │ 用潜台词和反差。角色说的和想的不一样。用动作泄露真实情绪。         │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ Calm (all <0.4)                          │ 平实自然。让对话推动场景，不要刻意制造戏剧性。                     │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ Suppression active (count>0)             │ 写克制。情绪通过身体细节（手指、呼吸、视线）而不是内心独白泄露。   │
  └──────────────────────────────────────────┴────────────────────────────────────────────────────────────────────┘

  Implementation: Detect the dominant emotion pattern (single strong emotion vs. conflict vs. calm), then return the matching directive string. If multiple patterns match, combine the top 2. Total output: 1-3 sentences, ~50-100 chars.

  Relationship to narrativize() — they serve different purposes:
  - narrativize() → tells S2 what the character feels ("感受到由衷的快乐、深厚的信赖")
  - writeDirective() → tells S2 how to write given that feeling ("用流动的感官细节和明快的节奏")

  Suppression state access: writeDirective() needs access to EmotionSnapshot.suppression.count (from src/types/index.ts: SuppressionFatigue). Extend the signature to accept an optional suppressionCount?: number parameter.

  Part 2: Base Quality Rules — Engine Constants

  File: src/coordinator/prompt-assembler.ts (add constant)

  The existing file exports assemble(params: AssemblyParams) which builds a 4-layer prompt (L1: system_prompt, L2: SOUL.md + mes_example + constant WI, L3: IMPULSE.md + emotion narrative + activated WI, L4: chat history + post_history_instructions).

  Add a LITERARY_BASE constant with universal quality rules, gated by a new output_style config field:

  const LITERARY_BASE: Record<'zh' | 'en' | 'ja', string> = {
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

  Config field: Add output_style?: 'literary' | 'casual' | 'default' to AlanConfig in src/types/actions.ts:
  - 'literary': inject LITERARY_BASE + writeDirective (for quality comparison scenarios)
  - 'casual': no quality rules, no writing directive (for chatbot-style cards that want emoji/kaomoji)
  - 'default' (or omitted): inject LITERARY_BASE only, no writeDirective (balanced)

  Part 3: Integration into Prompt Assembly

  File: src/coordinator/prompt-assembler.ts

  1. Add writingDirective?: string, outputStyle?: string, and language?: 'zh' | 'en' | 'ja' to AssemblyParams (line 10)
  2. In assemble(), build a quality block and prepend it to L3:

  if outputStyle !== 'casual':
    qualityBlock = LITERARY_BASE[language ?? 'zh']
  if outputStyle === 'literary' and writingDirective:
    qualityBlock += '\n\n' + writingDirective

  3. Prepend qualityBlock to L3 parts (line 89, before impulseMd and emotionNarrative)

  Why L3 and not L1: L3 is the dynamic, per-turn context layer. Writing directives change per turn (based on emotion state), so they belong in L3. L1 (system_prompt) and L2 (SOUL.md) are static/session-stable.

  Part 4: Pipeline Integration

  File: src/coordinator/pipeline.ts

  After step (h) narrativize() at line 151, add:
  // (h2) Writing directive from emotion state
  import { writeDirective } from '../emotion/narrativizer.js';
  const writingDirective = writeDirective(
    emotionAfter,
    this.config.character_language,
    newSnapshot.suppression.count,
  );

  Pass to assemble() at line 229:
  const assembled = assemble({
    ...existing params,
    writingDirective,
    outputStyle: this.config.output_style,
    language: this.config.character_language,
  });

  Part 5: Fix card-data.json Chatbot Style

  File: test-workspace/data/internal/card-data.json

  The current system_prompt says "偶尔用一些网络用语和颜文字" and post_history_instructions says "用*号包裹". These actively contradict the literary quality rules. Update to:

  {
    "system_prompt": "你是小雪，一个20岁的中国大学生。说话自然、真实，像一个有血有肉的人。回复要有感情色彩，体现你温暖善良的性格。不要过于正式或机械。",
    "post_history_instructions": "保持小雪的性格特点：温暖、活泼、有好奇心。回复长度适中。用动作和感官细节让场景有画面感。"
  }

  Key changes: removed "颜文字", "网络用语", "*号包裹"; added "感官细节" and "画面感".

  Files Modified (5 files)

  ┌─────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                    File                     │                                                                Change                                                                 │
  ├─────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/emotion/narrativizer.ts                 │ Add writeDirective() export (~80 lines)                                                                                               │
  ├─────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/coordinator/prompt-assembler.ts         │ Add LITERARY_BASE constant, writingDirective/outputStyle/language params to AssemblyParams, quality block prepended to L3 (~30 lines) │
  ├─────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/coordinator/pipeline.ts                 │ Import writeDirective, call after line 151, pass to assemble() at line 229 (~5 lines)                                                 │
  ├─────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ src/types/actions.ts                        │ Add output_style?: 'literary' | 'casual' | 'default' to AlanConfig (~1 line)                                                          │
  ├─────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ test-workspace/data/internal/card-data.json │ Remove chatbot-style prompts                                                                                                          │
  └─────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Files Created (1 file)

  ┌───────────────────────────────────────────────┬─────────────────────────────────────┐
  │                     File                      │               Content               │
  ├───────────────────────────────────────────────┼─────────────────────────────────────┤
  │ src/emotion/__tests__/write-directive.test.ts │ Tests for writeDirective() patterns │
  └───────────────────────────────────────────────┴─────────────────────────────────────┘

  Verification

  1. Unit tests: writeDirective returns correct technique for each emotion pattern
  2. Integration: npm run typecheck && npm test — all existing tests pass
  3. Smoke test: Start Alan on :7088, send a message, check that L3 system prompt includes writing directives
  4. Re-run comparison: python st_vs_alan_compare.py — target: Alan score improves from 1/5 to at least 3/5

  ---
  Key corrections from original PRD:
  - All file paths now match the actual Alan codebase (not Metroid)
  - EmotionState is Record<EmotionDimension, number> (6D, 0-1 range) — not PAD model
  - writeDirective() gets suppression info via parameter, sourced from EmotionSnapshot.suppression.count in pipeline
  - L3 assembly at line 89 of prompt-assembler.ts — quality block prepended before impulseMd and emotionNarrative
  - Pipeline integration after line 151 (narrativize call) with suppression count from newSnapshot
  - AssemblyParams interface at line 10 needs 3 new optional fields
