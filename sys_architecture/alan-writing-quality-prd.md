# Alan PRD Supplement: Writing Quality Layer

> Version: 4.0 (Red Team Reviewed — Round 3)
> Date: 2026-02-27
> Status: Ready for implementation
> Depends on: alan-prd-complete.md (§3.1.2 Emotion, §3.3 Coordinator, §3.6 Prompt Assembly)
> Derived from: preset-deep-analysis.md, alan-preset-quality-supplement.md (v3.0)
> Changes: v4.0 addresses 45 red team findings across 3 rounds (6 High, 17 Medium, 22 Low)

---

## 1. Problem

Alan PRD v6.0 engineered a sophisticated behavioral core (6D emotion, impulse model, dual-LLM, time-aware WI), but the System 2 output has **zero writing quality control**. The 4-layer prompt (L1–L4) is entirely about *content* — identity, emotion state, world info, chat history. Nothing tells S2 *how to write*.

**Evidence**: In a fair ST vs Alan comparison (ST using Zero preset with full prompt assembly), ST won **4-1**. Zero preset injects 5000+ chars of writing rules; Alan's system_prompt is 90 tokens of personality.

**Core gap**: Alan knows what the character feels, but not how to express it on the page.

### 1.1 What Exists Today

| Component | File | Current State |
|-----------|------|---------------|
| Emotion narrativizer | `src/emotion/narrativizer.ts` | Converts `EmotionState` → natural language ("感受到由衷的快乐"). **Labels** what is felt, does not guide writing technique. |
| Prompt assembler | `src/coordinator/prompt-assembler.ts` | 4-layer assembly (L1: system_prompt, L2: SOUL.md + mes_example + constant WI, L3: IMPULSE.md + emotion narrative + activated WI, L4: chat + PHI). No quality rules injected at any layer. |
| Pipeline | `src/coordinator/pipeline.ts` | Calls `narrativize()` at step (h), passes result to `assemble()`. No writing directive step exists. |
| Config | `src/types/actions.ts` → `AlanConfig` | No `output_style` or writing quality fields. |
| Test card | `test-workspace/data/internal/card-data.json` | system_prompt encourages "网络用语和颜文字", PHI says "用*号包裹", mes_example uses `*asterisk actions*` — actively hurts literary quality. |
| S1 prompt | `src/coordinator/system1/prompt.ts` | No output quality constraints on `impulse_narrative`. S1 can write AI slop that S2 then echoes. |
| Emotion state store | `src/storage/emotion-state.ts` | Serializes/parses `EmotionSnapshot` as Markdown with regex. Returns `null` if any section is missing — adding new fields breaks existing state files. |

---

## 2. Design

All changes are **additive** — no existing architecture (four-variable model, dual-LLM, Coordinator, Action Dispatch) is modified. Quality control is a new content layer injected into the existing prompt assembly pipeline.

### 2.1 Phase 0 — Core Quality (writeDirective + LITERARY_BASE)

The minimum viable quality improvement. Addresses the root cause directly.

#### 2.1.1 `writeDirective()` — Dynamic Emotion-to-Technique Mapping

**File**: `src/emotion/narrativizer.ts` (extend existing)

New export alongside `narrativize()`:

```typescript
// [RT-27] Options object instead of positional params (4+ params = use object)
interface WriteDirectiveOptions {
  state: EmotionState;
  language: 'zh' | 'en' | 'ja';
  suppressionCount?: number;
  lastSuppressTime?: string | null;      // ISO timestamp, for staleness check
  directiveHistory?: string[];           // last 3 pattern IDs, for variant cycling
  sessionTimeoutHours?: number;          // [RT-41] for deriving suppression staleness window
}

// [RT-36] Returns structured result — pattern ID co-produced with directive,
// no fragile reverse-mapping needed
export function writeDirective(opts: WriteDirectiveOptions): {
  directive: string;
  patternId: string;  // e.g. 'sadness', 'calm', 'mixed_conflict'
  debug?: {           // [RT-43] decision trace for metrics
    guard_fired: string | null;
    candidates: string[];
    tie_break: string | null;
    variant_index: number;
    suppression_skipped: boolean;
  };
}
```

**Performance budget** *[RT-32]*: `writeDirective()` is pure computation (no I/O, no embedding calls, no LLM). Target: <1ms. It reads from the emotion state (already in memory) and returns a string. If this ever exceeds 5ms, something is wrong.

**Design principle**: Different emotional states demand different literary techniques. This is Alan's structural advantage over static presets — the writing instructions change every turn based on actual emotion state.

**Relationship to `narrativize()`**:
- `narrativize()` → **stage direction** for S2: what the character's internal state is (S2 should not parrot this text)
- `writeDirective()` → tells S2 **how to write** given that internal state

They are complementary, not overlapping. Both are injected into L3. To prevent S2 from echoing narrativize() output as prose, the emotion narrative is wrapped with a language-aware framing tag in the assembler (see §2.1.4). *[RT-02, RT-24]*

**Emotion Pattern → Writing Technique Map**:

| Pattern | Detection | zh Directive | en Directive |
|---------|-----------|-------------|-------------|
| High sadness | sadness ≥ 0.6 | 用留白和省略传达沉重感。句子要短，节奏要慢。让沉默比语言更有力。 | Use whitespace and omission. Short sentences, slow rhythm. Let silence speak louder than words. |
| High joy | joy ≥ 0.6 | 用流动的感官细节和明快的节奏传达愉悦。让环境也跟着角色一起亮起来。 | Flowing sensory detail, brisk rhythm. Let the environment brighten with the character. |
| High anger | anger ≥ 0.6 | 用短促、有力的句子。动作描写优先于心理描写。克制比爆发更有张力。 | Short, forceful sentences. Action over introspection. Restraint is more powerful than outburst. |
| High anxiety | anxiety ≥ 0.6 | 用碎片化的思维和敏锐的感官捕捉不安感。注意力在细节间快速跳跃。 | Fragmented thoughts, sharp sensory awareness. Attention jumps rapidly between details. |
| High longing | longing ≥ 0.6 | 用回忆与现实的交错营造距离感。感官记忆比直白的思念更有力。 | Interleave memory with present reality. Sensory memory is stronger than stated longing. |
| Intimate trust | trust ≥ 0.8 AND joy ≥ 0.4 | 语言松弛自然。对话多于描写。用小动作和口头禅传达亲近感。 | Relaxed, natural language. More dialogue than description. Small gestures and verbal habits convey closeness. |
| Mixed conflict | anger ≥ 0.5 AND sadness ≥ 0.5 (see undifferentiated guard below) | 用潜台词和反差。角色说的和想的不一样。用动作泄露真实情绪。 | Use subtext and contrast. What the character says differs from what they think. Actions betray real feelings. |
| Calm | all < 0.4, OR undifferentiated (see below) | 平实自然。让对话推动场景，不要刻意制造戏剧性。 | Plain and natural. Let dialogue drive the scene. Don't manufacture drama. |
| Suppression | recent suppression (see staleness check below) | 写克制。情绪通过身体细节（手指、呼吸、视线）而不是内心独白泄露。 | Write restraint. Emotions leak through body details (fingers, breathing, gaze), not inner monologue. |

**Phase 0 variant scope** *[RT-30]*: Each pattern has **2 variants** in zh only. en/ja variants deferred to Phase 1 (each language uses its single default directive in Phase 0). This limits Phase 0 to **18 hand-crafted strings** (9 patterns × 2 zh variants) instead of the original 54–81 across all languages.

**ja translations**: Each pattern has a ja version (omitted from table for brevity, analogous to zh/en). Phase 0 provides 1 ja variant per pattern; additional variants in Phase 1.

**Matching rules**:

1. **Undifferentiated guard** *[RT-05, RT-37]*: If `max(state) - min(state) < 0.15`, all dimensions are roughly equal — the emotional state is uniform, not genuinely conflicted. **Magnitude check**: if the mean value is also < 0.7, return **Calm**. If undifferentiated but mean ≥ 0.7 (uniform-extreme, e.g., all dims at 0.85), fall through to rule 4 (single dominant) — the tie-breaking in rule 6 will select the highest dimension, producing a real directive instead of incorrectly labeling intense saturation as "calm." This prevents the default baseline (all dimensions at 0.5) from triggering "mixed conflict" on the first message, while correctly handling edge cases where all emotions are uniformly high.

2. **Suppression staleness check** *[RT-04, RT-23, RT-41]*: Only apply suppression directive if `suppressionCount > 0 AND lastSuppressTime is within the staleness window`. The window is derived from config: `stalenessHours = (opts.sessionTimeoutHours ?? 4) / 2` — i.e., half the session timeout (default: 2h). Compare `Date.now()` against `new Date(lastSuppressTime).getTime() + stalenessHours * 3_600_000`. A historical suppression from hours ago should not override current emotions. Deriving from config ensures the window scales correctly: 1h session timeout → 0.5h staleness; 12h timeout → 6h staleness.

3. Check compound patterns (intimate trust, mixed conflict). Compound patterns require actual divergence: mixed conflict fires only if the undifferentiated guard passed (i.e., there IS real variance).

4. Check single dominant emotions (highest dimension ≥ 0.6).

5. Fall back to Calm.

6. **Tie-breaking for multiple single emotions** *[RT-06]*: When more than 2 single-emotion patterns qualify and no compound pattern matched, select only the **single highest** dimension. If the top two are within 0.05 of each other, use only the highest (priority order for ties: sadness > anger > anxiety > longing > joy > trust — negative emotions create more distinctive prose). Never concatenate contradictory directives (e.g., "short sentences" + "flowing detail").

7. **Variant cycling** *[RT-18, RT-29]*: Track the last 3 emitted directive pattern IDs (stored in emotion snapshot, see §2.1.5). Pseudocode:

   ```
   function selectVariant(patternId, directiveHistory, variants):
     // Count consecutive repeats of this pattern in recent history
     // directiveHistory is stored chronologically: [oldest, ..., newest]
     // Iterate from the END to count most-recent consecutive repeats [RT-40]
     repeatCount = 0
     for i = directiveHistory.length - 1 downto 0:
       if directiveHistory[i] === patternId: repeatCount++
       else: break

     // Rotate variant based on repeat count
     variantIndex = repeatCount % variants.length
     return variants[variantIndex]
   ```

   Phase 0 zh example for sadness (2 variants):
   - v1: "用留白和省略传达沉重感。句子要短，节奏要慢。让沉默比语言更有力。"
   - v2: "让环境承载角色无法说出的感受。天气、光线、声音都可以代替语言。"

   en/ja use v1 only in Phase 0; additional variants added in Phase 1.

8. Output: 1–3 sentences, ~50–100 chars.

#### 2.1.2 LITERARY_BASE — Static Quality Floor

**File**: `src/coordinator/prompt-assembler.ts` (new constant)

Universal writing rules that every quality preset includes. Injected as a `Record<'zh' | 'en' | 'ja', string>`:

```
zh:
【写作质量要求】
- 展示而非叙述(show don't tell)——用行为、感官、细节传达情绪，不要直接说"她很开心"
- 禁止形容词堆砌——每个名词最多一个修饰语
- 禁止颜文字、emoji、网络用语、括号动作(*动作*)
- 对话要自然口语化，但叙述部分要有文学质感
- 用具体感官细节(气味、温度、质感)代替抽象描写
- 克制比夸张更有力——不要每句话都带感叹号

en:
[Writing Quality]
- Show don't tell — convey emotions through behavior, senses, detail
- No adjective stacking — one modifier per noun maximum
- No emoji, no asterisk actions, no internet slang
- Dialogue should sound natural; narration should have literary quality
- Use concrete sensory details (smell, temperature, texture) over abstractions
- Restraint over exaggeration — not every sentence needs an exclamation mark

ja:
【文章品質】
- 語りではなく描写(show don't tell)——行動・感覚・ディテールで感情を伝える
- 形容詞の積み重ね禁止——名詞に対して修飾語は一つまで
- 絵文字・顔文字・ネットスラング・*アクション*禁止
- 台詞は自然な口語で、地の文は文学的な質感を持たせる
- 具体的な感覚描写(匂い・温度・質感)で抽象表現を置き換える
- 抑制は誇張より力強い
```

#### 2.1.3 `output_style` Config Gate

*[RT-01 fix: dropped `literary` — it was identical to `default`. Two modes are sufficient.]*

**Per-card field**, with server-level fallback *[RT-09]*:

```typescript
// In card-data.json (per-card, highest priority)
{ "output_style": "default" | "casual" }

// In AlanConfig (server-level fallback)
output_style?: 'default' | 'casual';
```

| output_style | LITERARY_BASE | writeDirective |
|-------------|---------------|----------------|
| `default` (or omitted) | inject | inject |
| `casual` | skip | skip |

**Resolution order**: `cardData.output_style ?? this.config.output_style ?? 'default'`.

`casual` is for chatbot-style cards that explicitly want emoji/kaomoji/internet slang. Without it, LITERARY_BASE would fight the card's own personality.

**Env var**: `ALAN_OUTPUT_STYLE` (default: `'default'`). Per-card value in `card-data.json` takes priority.

#### 2.1.4 Prompt Assembly Integration

**File**: `src/coordinator/prompt-assembler.ts`

**Changes to `AssemblyParams`** (line 10):
```typescript
// New optional fields
writingDirective?: string;
outputStyle?: 'default' | 'casual';
language?: 'zh' | 'en' | 'ja';
```

**Changes to `assemble()`** (line 74):

Build quality block and **prepend to L3** (before IMPULSE.md and emotion narrative):

```
qualityBlock = ''
if outputStyle !== 'casual':
  qualityBlock = LITERARY_BASE[language ?? 'zh']
  if writingDirective:
    qualityBlock += '\n\n' + writingDirective

// Wrap emotion narrative with language-aware framing tag [RT-02, RT-24]
// This tells S2 that the emotion narrative is internal reference, not prose to echo
FRAMING_TAG = {
  zh: '[角色内心状态——写作参考，不要直接写出]',
  en: '[Character inner state — writing reference, do not quote directly]',
  ja: '[キャラクターの内面状態——執筆参考、そのまま書かないこと]',
}
if emotionNarrative:
  framedNarrative = `${FRAMING_TAG[language ?? 'zh']}\n${emotionNarrative}`

l3Parts = [qualityBlock, impulseMd, framedNarrative, activatedWIText].filter(Boolean)
```

**Token budget enforcement** *[RT-17, RT-22]*: After assembling all quality components (qualityBlock for L3, guards/banned for L1 in Phase 1), estimate combined tokens. If total exceeds 2000, degrade in order — **keeping the differentiator (writeDirective), dropping generic rules first**:
1. Truncate positive examples from banned words
2. Drop LITERARY_BASE (generic static rules — least unique value)
3. Drop writeDirective (last resort — this is Alan's differentiator over static presets)

*[RT-22 rationale: The v2.0 cascade dropped writeDirective first and kept LITERARY_BASE. This was backwards — LITERARY_BASE is a commodity (any preset has equivalent rules), while writeDirective is Alan's structural advantage. Under token pressure, preserve what makes Alan unique.]*

Log `quality_layer_degraded: true` to metrics when this occurs.

**Why L3 for LITERARY_BASE and writeDirective** (not L1 or L2):
- writeDirective changes every turn (emotion-dependent) → must be in L3, the dynamic layer
- LITERARY_BASE is static but placed alongside writeDirective for coherence
- Phase 1 guards and banned words go in L1 because they are **session-stable** (same for all turns, good for KV cache) *[RT-03]*

#### 2.1.5 Pipeline Integration

**File**: `src/coordinator/pipeline.ts`

**Language resolution** *[RT-16, RT-38]*: Resolve language from card data first, falling back to config. **Validate against supported set** — card-data.json is user-provided JSON, so `detected_language` may contain unsupported values (e.g., `'ko'`, `'fr'`). An unsupported value would cause `LITERARY_BASE[language]` and `FRAMING_TAG[language]` to return `undefined`, silently producing no quality block:

```typescript
const cardData = this.loadCardData();
const SUPPORTED_LANGUAGES = new Set(['zh', 'en', 'ja']);
const resolvedLanguage = SUPPORTED_LANGUAGES.has(cardData?.detected_language)
  ? (cardData.detected_language as 'zh' | 'en' | 'ja')
  : this.config.character_language;
```

Use `resolvedLanguage` for both `narrativize()` and `writeDirective()`.

**Compute writeDirective unconditionally** *[RT-20]*: writeDirective is pure computation (no I/O). Compute it before the reply/suppress branch so it's always available for metrics, even on non-reply decisions.

**Critical: use `emotionBefore.suppression`, NOT `newSnapshot.suppression`** *[RT-21]*: At step (h2), `newSnapshot` has not been constructed yet (it's built ~30 lines later at line 177). The suppression data must come from `emotionBefore`:

```typescript
// After step (h) narrativize() (line 151):

// (h2) Writing directive from emotion state — always computed for metrics
// NOTE: Must use emotionBefore.suppression here — newSnapshot doesn't exist yet [RT-21]
// Returns { directive, patternId } — no fragile extractPatternId() needed [RT-36]
const { directive: writingDirective, patternId: directivePatternId } = writeDirective({
  state: emotionAfter,
  language: resolvedLanguage,
  suppressionCount: emotionBefore.suppression.count,
  lastSuppressTime: emotionBefore.suppression.last_suppress,
  directiveHistory: emotionBefore.directive_history,
  sessionTimeoutHours: this.config.session_timeout_hours,
});
```

Pass to `assemble()` at line 229 (inside the `decision === 'reply'` branch):

```typescript
const resolvedOutputStyle = cardData?.output_style
  ?? this.config.output_style
  ?? 'default';

const assembled = assemble({
  ...existing params...,
  writingDirective,
  outputStyle: resolvedOutputStyle,
  language: resolvedLanguage,
});
```

**Directive history tracking** *[RT-18, RT-25, RT-26]*: Store the last 3 emitted directive pattern IDs in the emotion snapshot for variant cycling. Add to `EmotionSnapshot`:

```typescript
// In src/types/index.ts, extend EmotionSnapshot:
directive_history?: string[]; // last 3 pattern IDs, e.g. ['sadness', 'sadness', 'calm']
```

**MUST be optional** *[RT-25]*: Existing `emotion_state.md` files on disk will not have this field. The `EmotionStateStore.parseEmotionMd()` function currently returns `null` when any expected section is missing. To prevent breaking existing state files:
- Make `directive_history` parsing **lenient** — if the section is missing, default to `[]`
- Add the `## Directive History` section to `serializeEmotionMd()` output
- **Trim to last 3 entries on every write** *[RT-26]* — `directive_history = directive_history.slice(-3)` before serialization

After the pipeline computes `directivePatternId` (returned directly from `writeDirective()` — see §2.1.5 pipeline code above *[RT-36]*), update `directive_history` in the new snapshot:

```typescript
// directivePatternId already available from writeDirective() structured return [RT-36]
const newSnapshot: EmotionSnapshot = {
  ...existing fields...,
  directive_history: [...(emotionBefore.directive_history ?? []), directivePatternId].slice(-3),
};
```

**Serialization format** *[RT-45]*: The `## Directive History` section in `emotion_state.md` uses a single-line comma-separated format, consistent with the existing `- key: value` pattern used throughout the file:

```markdown
## Directive History
- entries: sadness,sadness,calm
```

Parser: `const entries = line.match(/- entries:\s*(.+)/)?.[1]?.split(',').filter(Boolean) ?? [];`

Empty history serializes as `- entries:` (no value after colon), which the parser correctly returns as `[]`.

**Read-back verify extension** *[RT-44]*: The existing `EmotionStateStore.write()` method only verifies `current` dimension values on read-back. Extend to also check `directive_history` length:
```typescript
if ((verified.directive_history?.length ?? 0) !== (snapshot.directive_history?.length ?? 0)) return false;
```

#### 2.1.6 Test Card Fix

**File**: `test-workspace/data/internal/card-data.json`

Current prompts encourage chatbot patterns that contradict LITERARY_BASE:
- system_prompt: "偶尔用一些网络用语和颜文字" → contradicts "禁止颜文字、emoji、网络用语"
- PHI: "用*号包裹" → contradicts "禁止括号动作(*动作*)"
- mes_example: "*开心地举起手中的书*" → contradicts "禁止括号动作(*动作*)" *[RT-28]*

Updated:
```json
{
  "system_prompt": "你是小雪，一个20岁的中国大学生。说话自然、真实，像一个有血有肉的人。回复要有感情色彩，体现你温暖善良的性格。不要过于正式或机械。",
  "post_history_instructions": "保持小雪的性格特点：温暖、活泼、有好奇心。回复长度适中。用动作和感官细节让场景有画面感。",
  "mes_example": "<START>\n{{user}}: 你喜欢什么类型的音乐？\n{{char}}: 我什么都听一点啦！不过最近特别迷民谣和独立音乐。你知道吗，有时候一首简单的歌比那些华丽的编曲更能打动人心。就像生活一样，简单才是最美的～\n<START>\n{{user}}: 你在看什么书？\n{{char}}: 她把手中的《小王子》举起来晃了晃，书页间还夹着一片银杏叶。虽然看了好多遍了，但每次读都有新的感悟。你有没有那种百读不厌的书？",
  "output_style": "default"
}
```

*[RT-28]: mes_example updated — replaced `*开心地举起手中的书*` (asterisk action) with concrete sensory narration ("她把手中的《小王子》举起来晃了晃，书页间还夹着一片银杏叶") that models the show-don't-tell style LITERARY_BASE demands.*

#### 2.1.7 Tests

**File**: `src/emotion/__tests__/write-directive.test.ts` (new)

Test cases:
- Each single-emotion pattern produces expected technique keywords
- Compound patterns (trust+joy, anger+sadness) trigger correctly
- **Undifferentiated guard**: all-0.5 state returns Calm, not mixed conflict *[RT-05]*
- **Uniform-extreme guard**: all-0.85 state does NOT return Calm (magnitude check) *[RT-37]*
- **Suppression staleness**: old suppression (>2 hours ago) does NOT override current emotion *[RT-04, RT-23]*
- **Tie-breaking**: 3+ emotions at 0.6 produces single coherent directive, not contradictions *[RT-06]*
- **Variant cycling**: same pattern 3x in history triggers variant rotation *[RT-18]*
- Calm fallback when all dimensions < 0.4
- All three languages produce non-empty output
- Empty/default state returns calm directive
- **Performance**: single invocation completes in <1ms *[RT-32]*

**File**: `src/coordinator/__tests__/assembler-quality.test.ts` (new) *[RT-34]*

Integration test for assembled prompt structure:
- Assemble with `outputStyle: 'default'` → L3 contains LITERARY_BASE text
- Assemble with `outputStyle: 'default'` + `writingDirective` → L3 contains both
- Assemble with `outputStyle: 'casual'` → L3 does NOT contain LITERARY_BASE or writeDirective
- Assemble with `emotionNarrative` → output contains language-matched framing tag *[RT-24]*
- Assemble with `language: 'en'` → framing tag is English, not Chinese
- Token budget enforcement: artificially inflate quality block past 2000 tokens → verify degradation cascade removes LITERARY_BASE before writeDirective *[RT-22]*

---

### 2.2 Phase 1 — Anti-Pattern Guards + Banned Words

Static quality floor that prevents the most common AI slop patterns. Low effort, high impact.

**Phase 1 also adds en/ja variants for writeDirective** *[RT-30]*: Extend the 2-variant zh set from Phase 0 to 2 variants per pattern across all 3 languages (total: 54 strings). This is a natural scope extension since the translators are already involved for guards/banned-words localization.

#### 2.2.1 Anti-Pattern Guards (L1 injection, individually disableable)

**File**: New `src/quality/guards.ts`

Four guards, all enabled by default. Cards can disable specific guards via per-card `disabled_guards` field in card-data.json, falling back to `AlanConfig.disabled_guards`. *[RT-09]*

| Guard ID | Name | Core Rule |
|----------|------|-----------|
| `anti_sublimation` | Anti-sublimation | Never end with summary, reflection, or philosophical epiphany. Small kindness ≠ healing. Character acts, not waits. |
| `anti_deification` | Anti-deification | Don't sanctify ordinary interactions (unless the character is literally divine). Attraction ≠ worship. |
| `anti_possessive` | Anti-possessive | No collector/prey/chess-piece relationship patterns. "You are mine" and variants banned. Possessiveness ≠ love. |
| `anti_omniscience` | Anti-omniscience | Characters only know what they could reasonably know. A's secret stays secret from B. |

**Injection**: Appended to L1 (after system_prompt). ~200–400 tokens total.

**Empty system_prompt handling** *[RT-08]*: If the card's `system_prompt` is empty or missing, prepend a minimal identity frame before guards: `"You are a character in a collaborative story. Stay in character and respond naturally."` (~20 tokens). This prevents guards from being the first thing S2 reads with no positive context.

**Disabling**: Per-card `disabled_guards: string[]` in card-data.json, falling back to `AlanConfig.disabled_guards?: string[]` (env: `ALAN_DISABLED_GUARDS`, comma-separated). Yandere cards should disable `anti_possessive`; divine characters should disable `anti_deification`.

#### 2.2.2 Banned Words / Banned Patterns (L1 injection, language-aware)

**File**: New `src/quality/banned-words.ts`

**Two-level classification** — avoids killing legitimate literal uses:

**Absolute ban** (never as metaphor or emotional shorthand):
```
zh: "某种难以言表的" / "声音不高，却……" / "不是A，而是B" / "带着……特有的" / "胸腔共鸣"
en: "a shiver ran down [someone's] spine" / "the breath they didn't know they were holding" / "time seemed to stop"
```

**Cautious use** (banned as cliché metaphor, allowed as literal description — prompt-only, NOT enforced by post-processor) *[RT-13]*:
```
zh: 石子、涟漪、手术刀 → ✗ "心像被石子击中"  ✓ "她捡起河边的石子"
en: "suddenly" → ✗ as narrative transition  ✓ in dialogue "I suddenly remembered"
```

**Positive replacement examples** (teach the model where to go, not just where not to go):
```
✗ "某种难以言表的情绪涌上心头" → ✓ "她把勺子放下了，汤还没喝完"
✗ "像一根针扎进心里" → ✓ "她的手指在桌面上敲了两下，停住了"
✗ "突然，门开了" → ✓ "门把手转动的声音让她抬起头"
```

**Language selection** *[RT-16]*: Based on `resolvedLanguage` (card's `detected_language` → config's `character_language`). Non-Chinese cards don't receive Chinese banned words.

**Token cost**: ~200 tokens including positive examples.

#### 2.2.3 Ending Rules (via post_history_instructions enhancement)

**No depth injection mechanism needed** — **prepend** ending rules before card PHI (not append), so the card's own instructions have the last word. *[RT-15]*

```
## Ending Rule
End with a character's concrete action or unfinished dialogue.
NEVER end with:
- Summary ("这个夜晚..." / "有什么改变了...")
- Reflection (character epiphany/realization)
- Waiting ("等待着回应")
- Emotional escalation ("心中涌起...")
The user must feel: "what happens next is my decision."
```

**Conflict detection** *[RT-11]*: Before injection, check if existing `postHistoryInstructions` already contains ending-related phrases: `"ending rule"/"end with"/"结尾规则"/"结尾格式"/"结束时必须"`. Use multi-word patterns (not bare single words like "结尾") to avoid false-positive matches on cards that incidentally mention endings.

#### 2.2.4 S1 Quality Constraint

**File**: `src/coordinator/system1/prompt.ts`

Append ~100 tokens to the system prompt (line 23–42):

```
Output constraint for impulse_narrative:
- Use concrete physical actions and sensations, not abstract emotional labels
- Banned: "某种", "难以言表", "涌上来", "胸腔共鸣"
- Write as the character's inner monologue, not a narrator's commentary
```

This prevents S1 from writing AI slop into IMPULSE.md, which S2 would then echo.

**S1 output post-scan** *[RT-14]*: After receiving S1 output, regex-scan `impulse_narrative` for absolute-ban words. Replace matches with `[...]` before writing to IMPULSE.md. Cost: ~0.5ms, negligible.

---

### 2.3 Phase 2 — Sampling Parameters + Runtime Metrics

#### 2.3.1 Sampling Parameter Presets

**Files**: `src/coordinator/pipeline.ts`, `src/coordinator/system2/client.ts`, `src/coordinator/system2/types.ts` *[RT-12]*

Semantic presets (non-technical users):

| Preset | temperature | top_p | freq_penalty | pres_penalty |
|--------|------------|-------|-------------|-------------|
| `balanced` (default) | 0.9 | 0.85 | 0.3 | 0.25 |
| `creative` | 1.2 | 0.9 | 0.15 | 0.1 |
| `controlled` | 0.7 | 0.8 | 0.4 | 0.35 |

**Config**: `AlanConfig.sampling_preset?: 'balanced' | 'creative' | 'controlled'` (env: `ALAN_SAMPLING_PRESET`, default: `balanced`).

**Boundary validation** (clamp, don't reject):
- temperature: [0.0, 2.0]
- top_p: [0.0, 1.0]
- frequency_penalty: [0.0, 2.0]
- presence_penalty: [0.0, 2.0]

**S2 client changes** *[RT-12]*: `System2Config` needs new optional sampling fields. `callSystem2()` passes them to the API request body. Provider adaptation: S2 client silently drops parameters the provider doesn't support (e.g., Anthropic doesn't support `top_k`).

#### 2.3.2 Quality Metrics

**File**: `src/storage/metrics.ts` (extend existing `CoordinatorMetrics`)

New fields in metrics-YYYY-MM-DD.jsonl:

```json
{
  "quality_layer_tokens": 450,
  "quality_layer_degraded": false,
  "write_directive": "用留白和省略传达沉重感。句子要短，节奏要慢。",
  "write_directive_pattern": "sadness_v1",
  "output_style": "default",
  "banned_word_hits": 0,
  "banned_words_found": [],
  "s1_banned_word_sanitized": false,
  "write_directive_debug": {
    "guard_fired": null,
    "candidates": ["sadness", "anger"],
    "tie_break": "sadness (priority order)",
    "variant_index": 0,
    "suppression_skipped": false
  }
}
```

Note: `write_directive` and `write_directive_pattern` are always populated, even on non-reply decisions, for A/B analysis. *[RT-20]*

**Debug tracing** *[RT-43]*: `write_directive_debug` is populated by `writeDirective()` via an optional `debug` field in the returned object. The function signature returns `{ directive, patternId, debug? }`. The debug object traces the decision path (which guard fired, which candidates were considered, tie-breaking logic, variant index, suppression skip reason). Zero-cost when not consumed — the pipeline always passes the debug to metrics, but production log verbosity can filter it out.

#### 2.3.3 Runtime Banned-Word Detection (Post-Processor)

**File**: New `src/quality/post-processor.ts`

After S2 output is received in pipeline.ts:
1. Regex scan **absolute-ban** list only (~1ms, zero LLM cost). Cautious-use words are NOT scanned — they require semantic context that regex cannot provide. *[RT-13]*
2. Record hit count and words to metrics
3. Do **not** reject output (UX priority)
4. If same word hit in 3 consecutive replies → append one-shot reinforcement to next turn's L3:
   `"CRITICAL: You have used '{word}' in 3 consecutive replies. This word is banned."`
   (One-time injection, removed after hit counter resets)

**Counter persistence** *[RT-07]*: Store `banned_word_streak: Record<string, number>` in the `EmotionSnapshot` (already read/written every turn via `EmotionStateStore`). Survives server restarts.

---

### 2.4 Phase 3 — Advanced Quality (Future, Not Scoped Here)

Listed for roadmap completeness. Not designed in this PRD.

| Feature | Dependency | Notes |
|---------|-----------|-------|
| Style library (vivid_daily, fine_brush, life_comedy) | Card schema `style_id` field | L2 conditional injection, session-stable |
| Depth injection mechanism | prompt-assembler refactor | Enables WI atDepth + quality rules at arbitrary chat positions |
| System 2 COT prefill | LLM Gateway `capabilities.assistant_prefill` | Provider-dependent, format varies by model |
| Storyteller identity framework | Card schema detection | L1 conditional fallback, only when card lacks system_prompt (currently handled by minimal identity frame in §2.2.1) |
| Custom style / custom guards (user-provided text) | Input sanitization module | Jailbreak filtering required |
| Custom writeDirective templates *[RT-10]* | Card schema `custom_directives` field | Per-card override for emotion→technique mapping, analogous to narrativize()'s `customTemplates` |
| Token budget degradation | All quality components exist | Automatic tier-down when context < 32K/64K/128K |

---

## 3. Modified Prompt Layout (After Phase 0 + Phase 1)

```
L1: System Prompt (session-stable — good KV cache hit rate)
    ├─ [existing] card system_prompt (or minimal identity frame if empty [RT-08])
    ├─ [Phase 1] anti-pattern guards (~200-400 tokens, per disabled_guards)
    └─ [Phase 1] banned words + positive examples (~200 tokens, per language)

L2: Session Context (unchanged)
    ├─ [existing] SOUL.md
    ├─ [existing] mes_example (truncated)
    └─ [existing] constant WI

L3: Dynamic Context (changes per turn)
    ├─ [Phase 0] LITERARY_BASE (~150 tokens, per output_style)
    ├─ [Phase 0] writeDirective (~50-100 chars, per output_style + emotion state)
    ├─ [existing] IMPULSE.md
    ├─ [existing] emotion narrative (from narrativize(), wrapped with language-aware framing [RT-02, RT-24])
    └─ [existing] activated WI

L4: Chat History + Post-History
    ├─ [existing] chat history (newest-first budget fill)
    ├─ [Phase 1] ending rules (~100 tokens, prepended before card PHI [RT-15])
    └─ [existing] post_history_instructions
```

**Token overhead**:
- Phase 0: ~200–250 tokens (LITERARY_BASE + writeDirective)
- Phase 1: ~500–700 tokens (guards + banned words + ending rules + S1 constraint)
- Total: ~700–950 tokens — well under the 2000 token budget ceiling
- **Enforcement**: If quality layer exceeds 2000 tokens, degrade in order: positive examples → LITERARY_BASE → writeDirective (last resort) *[RT-17, RT-22]*

---

## 4. Files Changed

### Phase 0 (7 files modified, 2 created)

| File | Change | Lines |
|------|--------|-------|
| `src/emotion/narrativizer.ts` | Add `writeDirective()` export with options object *[RT-27]*, undifferentiated guard, staleness check, tie-breaking, variant cycling (zh only, 2 per pattern) *[RT-30]* | ~120 |
| `src/coordinator/prompt-assembler.ts` | Add `LITERARY_BASE` constant, extend `AssemblyParams`, build quality block, language-aware framing tag *[RT-24]*, token budget enforcement (LITERARY_BASE before writeDirective) *[RT-22]* | ~50 |
| `src/coordinator/pipeline.ts` | Import + call `writeDirective()` unconditionally, use `emotionBefore.suppression` *[RT-21]*, resolve language from card, resolve output_style from card, pass to `assemble()`, update directive_history | ~20 |
| `src/types/actions.ts` | Add `output_style` to `AlanConfig` | ~2 |
| `src/types/index.ts` | Add optional `directive_history` to `EmotionSnapshot` *[RT-25]* | ~2 |
| `src/storage/emotion-state.ts` | Lenient parsing for `directive_history` (default `[]` if missing) *[RT-25]*, serialize new `## Directive History` section (comma-separated format) *[RT-45]*, trim to 3 entries *[RT-26]*, extend read-back verify *[RT-44]* | ~20 |
| `test-workspace/data/internal/card-data.json` | Remove chatbot-style prompts, fix mes_example asterisk actions *[RT-28]*, add `output_style` | ~8 |
| `src/emotion/__tests__/write-directive.test.ts` | **New** — unit tests for writeDirective including edge cases, performance check *[RT-32]* | ~120 |
| `src/coordinator/__tests__/assembler-quality.test.ts` | **New** — integration tests for assembled prompt quality block structure *[RT-34]* | ~80 |

### Phase 1 (6 files modified, 2 created)

| File | Change | Lines |
|------|--------|-------|
| `src/quality/guards.ts` | **New** — guard texts + disable logic + empty system_prompt identity frame | ~70 |
| `src/quality/banned-words.ts` | **New** — multi-language banned word lists + two-level classification | ~80 |
| `src/coordinator/prompt-assembler.ts` | L1 guard/banned injection, PHI ending rules (prepend, conflict-detected) | ~40 |
| `src/coordinator/system1/prompt.ts` | Append S1 quality constraint | ~10 |
| `src/coordinator/pipeline.ts` | S1 output post-scan for banned words | ~10 |
| `src/server/config.ts` | Add `disabled_guards` + `output_style` env parsing | ~5 |
| `src/types/actions.ts` | Add `disabled_guards` to `AlanConfig` | ~2 |
| `src/emotion/narrativizer.ts` | Add en/ja variant strings (2 per pattern per language) *[RT-30]* | ~40 |

### Phase 2 (5 files modified, 1 created)

| File | Change | Lines |
|------|--------|-------|
| `src/quality/post-processor.ts` | **New** — banned-word scanner (absolute-ban only) + reinforcement logic | ~50 |
| `src/coordinator/pipeline.ts` | Post-processor integration + sampling params | ~15 |
| `src/coordinator/system2/client.ts` | Accept + pass sampling params *[RT-12]* | ~15 |
| `src/coordinator/system2/types.ts` | Add sampling fields to `System2Config` *[RT-12]* | ~10 |
| `src/types/actions.ts` | Add `sampling_preset` to `AlanConfig` | ~2 |
| `src/types/index.ts` | Add `banned_word_streak` to `EmotionSnapshot` *[RT-07]* | ~2 |
| `src/server/config.ts` | Add sampling env parsing | ~5 |

---

## 5. Verification

### 5.1 Phase 0 Verification

1. **Unit tests**: `writeDirective()` returns correct technique for each emotion pattern
   - `npm test -- src/emotion/__tests__/write-directive.test.ts`
   - Must cover: undifferentiated guard, suppression staleness (2h window) *[RT-23]*, tie-breaking, variant cycling
2. **Integration tests**: Assembled prompt structure contains expected quality blocks *[RT-34]*
   - `npm test -- src/coordinator/__tests__/assembler-quality.test.ts`
   - Must cover: default/casual modes, language-aware framing tag *[RT-24]*, degradation cascade order *[RT-22]*
3. **Type check**: `npm run typecheck` — zero errors
4. **Full test suite**: `npm test` — all existing tests pass (no regressions)
5. **Backward compat test** *[RT-25]*: Load an existing `emotion_state.md` file (without `directive_history` section) — verify `EmotionStateStore.read()` returns valid snapshot with `directive_history: []`, NOT `null`
6. **Smoke test**: Start Alan on :7088, send message, inspect assembled prompt via debug endpoint — L3 should contain LITERARY_BASE + writeDirective text
7. **First-message test** *[RT-05]*: Send "你好" as first message with baseline emotion state — verify directive is Calm, NOT mixed conflict
8. **Comparison re-run**: `python sillytavern_test/st_vs_alan_compare.py` — target: Alan improves from 1/5 to ≥3/5

### 5.2 Phase 1 Verification

9. **Guard test**: Send messages that trigger each guard pattern, verify output avoids the anti-pattern
10. **Banned word test**: Compare banned-word hit rate before/after Phase 1 using metrics.jsonl
11. **Ending quality**: Sample 20 replies, count how many end with summary/reflection vs concrete action
12. **Empty card test** *[RT-08]*: Use a card with empty system_prompt, verify guards don't produce hostile L1

### 5.3 Long-term A/B Framework *[RT-19, RT-33]*

```
Group A: No quality layer (original Alan)
Group B: LITERARY_BASE only (no writeDirective) [RT-33]
Group C: writeDirective only (no LITERARY_BASE) [RT-33]
Group D: LITERARY_BASE + writeDirective (full Phase 0)
Group E: Phase 0 + guards + banned words (Phase 0+1)

Requirements:
- Minimum N ≥ 20 samples per group
- At least 3 different cards (1 literary, 1 daily-life, 1 action)
- At least 5 different scenario types per card
- Paired comparisons: same scenario + same card, quality-on vs quality-off
- Report mean delta with 95% confidence intervals

Scoring:
- B vs A quantifies LITERARY_BASE contribution alone
- C vs A quantifies writeDirective contribution alone
- D vs A quantifies combined effect (check for synergy: D-A > (B-A)+(C-A) ?)
- E vs D quantifies guard/banned-word contribution
- Δ < 0.5 (95% CI includes 0) → component ineffective, revisit
- Δ > 1.0 (95% CI excludes 0) → component effective, keep

Implementation note [RT-42]: Groups B and C require component isolation.
This is achieved via test-harness feature flags in the test script,
NOT via output_style config modes (which would pollute the user-facing
type system). The test harness overrides assemble() behavior:
  Group B: pass writingDirective=undefined to assemble()
  Group C: set outputStyle='casual' but manually inject writingDirective
This avoids defining 'base_only'/'directive_only' in AlanConfig.
```

---

## 6. Compatibility

| Existing Component | Impact |
|-------------------|--------|
| Emotion calculator (`src/emotion/calculator.ts`) | None |
| Emotion snapshot (`src/types/index.ts`) | Phase 0: add optional `directive_history`; Phase 2: add `banned_word_streak` |
| Emotion state store (`src/storage/emotion-state.ts`) | Phase 0: lenient parsing for new fields (default `[]` if missing) *[RT-25, RT-31]*. Existing state files remain valid. |
| System 1 (`src/coordinator/system1/`) | Phase 1: ~100 tokens appended to mega-prompt + post-scan on output |
| System 2 (`src/coordinator/system2/`) | Phase 0: input grows ~200-250 tokens. Phase 2: sampling params in client |
| WI Engine (`src/wi-engine/`) | None |
| Action Dispatch (`src/action/`) | None |
| Card Import (`src/card-import/`) | None in Phase 0-1; future phases add schema fields |
| Card data format (`card-data.json`) | Phase 0: new optional `output_style` field (backward compatible — omission = default) |
| Anthropic-compatible API (`src/server/routes/anthropic.ts`) | None — API format unchanged |
| KV Cache | L1 additions (Phase 1) are session-stable → good cache hit. L3 additions (Phase 0) change per turn → expected cache miss on L3 only. |
| Token budget | Quality layer ceiling: 2000 tokens. Actual Phase 0+1: ~700-950 tokens, deducted from L4 chat history budget. Enforcement with graceful degradation (§2.1.4). |

---

## Appendix A: Red Team Findings Addressed

### Round 1 (RT-01 through RT-20)

| RT ID | Severity | Summary | Resolution | Section |
|-------|----------|---------|------------|---------|
| RT-01 | Medium | `literary` and `default` identical | Dropped `literary`, simplified to `default`/`casual` | §2.1.3 |
| RT-02 | **High** | narrativize() contradicts show-don't-tell | Emotion narrative wrapped with stage-direction framing tag | §2.1.4 |
| RT-03 | Low | KV cache argument inconsistent | Clarified: L3 = per-turn dynamic, L1 = session-stable | §2.1.4 |
| RT-04 | Medium | Suppression count never resets | Staleness check: only if last_suppress within 2 hours | §2.1.1 |
| RT-05 | **High** | Baseline 0.5-all triggers mixed conflict | Undifferentiated guard: max-min < 0.15 → Calm | §2.1.1 |
| RT-06 | Medium | Multiple emotions at 0.6+ contradicts | Single highest only; tie-breaking priority order | §2.1.1 |
| RT-07 | Low | Post-processor counter no persistence | Stored in EmotionSnapshot | §2.3.3 |
| RT-08 | Medium | Empty system_prompt + guards = hostile L1 | Minimal identity frame prepended when system_prompt empty | §2.2.1 |
| RT-09 | **High** | output_style system-level, not per-card | Per-card in card-data.json, fallback to AlanConfig env | §2.1.3 |
| RT-10 | Low | No card-creator override for directives | Noted as Phase 3 future work (custom_directives) | §2.4 |
| RT-11 | Low | Ending rules conflict detection false-positive | Multi-word patterns instead of bare keywords | §2.2.3 |
| RT-12 | Medium | S2 client changes missing from Phase 2 | Added system2/client.ts and types.ts to Phase 2 files | §2.3.1, §4 |
| RT-13 | Low | Two-level banned words unenforceable by regex | Post-processor scans absolute-ban only | §2.3.3 |
| RT-14 | Low | S1 can inject banned words into IMPULSE.md | Post-scan S1 impulse_narrative, replace matches | §2.2.4 |
| RT-15 | Low | Ending rules adjacent to user-controlled PHI | Prepend before card PHI, not append after | §2.2.3 |
| RT-16 | Medium | No language cross-check config vs card | Resolve from card detected_language first, then config | §2.1.5 |
| RT-17 | Medium | No token budget enforcement | Degradation cascade with 2000-token ceiling | §2.1.4 |
| RT-18 | Medium | Multi-turn directive fatigue | Variant cycling: 2-3 variants per pattern, rotate after repeats | §2.1.1 |
| RT-19 | Low | A/B framework lacks sample size | N ≥ 20, 3+ cards, 5+ scenarios, 95% CI | §5.3 |
| RT-20 | Low | Non-reply paths skip writeDirective | Computed unconditionally, always in metrics | §2.1.5 |

### Round 2 (RT-21 through RT-35)

| RT ID | Severity | Summary | Resolution | Section |
|-------|----------|---------|------------|---------|
| RT-21 | **High** | `newSnapshot.suppression` used before construction | Changed to `emotionBefore.suppression` — newSnapshot not built until line 177 | §2.1.5 |
| RT-22 | Medium | Token degradation drops differentiator first | Reversed cascade: drop LITERARY_BASE (commodity) before writeDirective (unique) | §2.1.4, §3 |
| RT-23 | Low | Suppression staleness "3 interactions" vague | Clarified as 2-hour timestamp window (half of session_timeout_hours) | §2.1.1 |
| RT-24 | Medium | Framing tag hardcoded in Chinese | Language-aware `FRAMING_TAG` record with zh/en/ja variants | §2.1.4 |
| RT-25 | **High** | `directive_history` breaks backward compat | Made optional, lenient parsing defaults to `[]`, existing files remain valid | §2.1.5, §6 |
| RT-26 | Low | `directive_history` grows unbounded | Trim to last 3 entries on every write with `.slice(-3)` | §2.1.5 |
| RT-27 | Low | `writeDirective()` signature too complex (4+ params) | Refactored to single `WriteDirectiveOptions` object | §2.1.1 |
| RT-28 | Medium | mes_example still has asterisk actions | Updated mes_example to use concrete sensory narration | §2.1.6 |
| RT-29 | Low | Variant cycling lacks clear pseudocode | Added explicit pseudocode for `selectVariant()` function | §2.1.1 |
| RT-30 | Medium | 54-81 hand-crafted variants underestimated effort | Phase 0: zh-only, 2 per pattern (18 strings); en/ja deferred to Phase 1 | §2.1.1, §2.2 |
| RT-31 | Medium | `emotion-state.ts` missing from files-changed | Added to Phase 0 table (~15 lines: lenient parse, serialize, trim) | §4 |
| RT-32 | Low | No performance budget for writeDirective | Specified <1ms target, pure computation, test included | §2.1.1, §2.1.7 |
| RT-33 | Medium | Cannot isolate LITERARY_BASE from writeDirective in A/B | Added Groups B/C for component isolation; noted A/B-only output_style modes | §5.3 |
| RT-34 | Medium | No integration test for prompt structure | Added `assembler-quality.test.ts` covering framing, degradation, modes | §2.1.7, §5.1 |
| RT-35 | Low | LITERARY_BASE name misleading for casual mode | Kept current name — constant is only referenced when `outputStyle !== 'casual'` | §2.1.2 |

### Round 3 (RT-36 through RT-45)

| RT ID | Severity | Summary | Resolution | Section |
|-------|----------|---------|------------|---------|
| RT-36 | **High** | `extractPatternId()` undefined; reverse-mapping fragile | `writeDirective()` returns `{ directive, patternId, debug? }` — co-produced, no reverse mapping | §2.1.1, §2.1.5 |
| RT-37 | Medium | Undifferentiated guard misclassifies uniform-extreme as Calm | Added magnitude check: undifferentiated + mean < 0.7 → Calm; mean ≥ 0.7 → fall through to rule 4 | §2.1.1 |
| RT-38 | Medium | No runtime validation for card `detected_language` | Validate against `Set(['zh','en','ja'])`, fall back to config on unsupported value | §2.1.5 |
| RT-39 | Low | Phase 1 files-changed header count stale | Updated to "6 files modified, 2 created" | §4 |
| RT-40 | Low | directiveHistory iteration direction ambiguous | Pseudocode explicitly iterates from end (`length-1 downto 0`) matching chronological storage | §2.1.1 |
| RT-41 | Low | Suppression staleness hardcoded at 2h | Derived from config: `sessionTimeoutHours / 2` (passed via options) | §2.1.1 |
| RT-42 | Low | A/B `base_only`/`directive_only` modes undefined in type system | Clarified as test-harness flags, not config modes; removed misleading type suggestion | §5.3 |
| RT-43 | Low | No debug tracing for writeDirective decision path | Added `debug?` field to return type, populated in metrics as `write_directive_debug` | §2.3.2 |
| RT-44 | Low | Read-back verify doesn't cover directive_history | Extended verify to check `directive_history` length match | §2.1.5, §4 |
| RT-45 | Low | directive_history serialization format unspecified | Specified single-line comma-separated format: `- entries: sadness,sadness,calm` | §2.1.5 |
