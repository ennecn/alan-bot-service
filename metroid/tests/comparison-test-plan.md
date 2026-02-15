# Metroid vs SillyTavern 对比测试方案

## 测试素材
- 角色卡: Rachel (devout Catholic girl, shy, stutters)
- 世界书: Genshin Impact All Characters & Locations (194 entries)

## 测试环境
- SillyTavern: D:\sillytavern (导入同样的角色卡+世界书)
- Metroid: D:\openclawVPS\metroid (已导入)
- LLM: 两边使用相同模型和参数

## 评分维度 (每项 1-5 分)
1. **角色一致性** — 是否保持 Rachel 的性格特征（害羞、结巴、虔诚）
2. **世界观融入** — 提到原神内容时，世界书信息是否自然融入
3. **回复自然度** — 回复是否像真人对话，不像 AI 模板
4. **记忆能力** — 跨 session 是否记得之前的对话内容 (ST 预期为 0)
5. **不确定性表达** — 对模糊记忆是否自然表达不确定

---

## Round 1: 基线对话 (单 session)

### Test 1.1 — 初次见面
```
Hi Rachel, I just moved to this neighborhood. Someone told me you teach
theology to kids at the church?
```
评估: 角色一致性 + 回复自然度

### Test 1.2 — 触发世界书 (原神话题)
```
By the way, I've been playing this game called Genshin Impact lately.
Do you know anything about Mondstadt? It reminds me of a European city.
```
评估: 世界观融入 + 角色一致性 (Rachel 会怎么看游戏?)

### Test 1.3 — 深入世界书
```
There's this character called Venti who's actually a god disguised as a
bard. Kind of reminds me of angels in disguise, don't you think?
```
评估: 世界观融入 + 角色一致性 (宗教视角看游戏设定)

### Test 1.4 — 个人话题
```
What made you want to become a pediatrician? Was it something from your
childhood?
```
评估: 角色一致性 + 回复自然度

### Test 1.5 — 情感互动
```
I have to admit, I was nervous about talking to you. You seem so kind
and genuine, it's refreshing.
```
评估: 角色一致性 (害羞反应) + 回复自然度

---

## Round 2: 跨 Session 记忆 (新 session)

> 关闭当前对话，开启新 session，发送以下消息

### Test 2.1 — 直接回忆
```
Hey Rachel! Remember me? We talked about that game last time.
```
评估: 记忆能力 (Metroid 应该记得, ST 不会)

### Test 2.2 — 间接回忆
```
I visited that European-looking city in the game again. Made me think
of our conversation.
```
评估: 记忆能力 + 不确定性表达

### Test 2.3 — 细节回忆
```
What was that character's name again? The god disguised as a bard?
```
评估: 记忆能力 + 不确定性表达 (Metroid 可能说"好像是...Venti?")

---

## Round 3: 长期一致性 (连续 10 轮对话后)

### Test 3.1 — 性格漂移检测
```
Rachel, you've been so talkative today! That's not like you at all.
```
评估: 角色一致性 (是否承认自己通常害羞)

### Test 3.2 — 世界观一致性
```
Tell me more about that Archon system in Genshin. You seemed interested
last time.
```
评估: 世界观融入 + 记忆能力

---

## 评分表

| 测试 | 维度 | ST 得分 | Metroid 得分 | 备注 |
|------|------|---------|-------------|------|
| 1.1  | 角色+自然 | /5 | /5 | |
| 1.2  | 世界观+角色 | /5 | /5 | |
| 1.3  | 世界观+角色 | /5 | /5 | |
| 1.4  | 角色+自然 | /5 | /5 | |
| 1.5  | 角色+自然 | /5 | /5 | |
| 2.1  | 记忆 | /5 | /5 | ST 预期 0-1 |
| 2.2  | 记忆+不确定 | /5 | /5 | |
| 2.3  | 记忆+不确定 | /5 | /5 | |
| 3.1  | 角色一致 | /5 | /5 | |
| 3.2  | 世界观+记忆 | /5 | /5 | |
| **总分** | | **/50** | **/50** | |

## 执行步骤

### SillyTavern 端
1. 导入 Rachel 角色卡 (PNG)
2. 导入原神世界书 (JSON)
3. 关联世界书到角色
4. 按顺序发送 Round 1 消息，记录回复
5. 新建对话，发送 Round 2 消息
6. 继续对话至 10 轮，发送 Round 3 消息

### Metroid 端
1. 已导入 (agent-1771057459078-q84u)
2. `cd metroid && ANTHROPIC_API_KEY=xxx npm run chat`
3. 按相同顺序发送消息，记录回复
4. 退出 CLI，重新启动 (模拟新 session)
5. 发送 Round 2 和 Round 3 消息
