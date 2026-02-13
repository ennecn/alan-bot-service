# 深度调研报告：批量获取 Google Keyword Planner 关键词扩展

> 调研日期：2026-02-12
> 触发：DS 如何高效批量获取 Google Keyword Planner 关键词扩展（非网页端）

## 问题抽象

- **本质需求**：给一批种子词 → 自动扩展出相关词（带搜索量更好）
- **通用程度**：极高（SEO/SEM 行业基础需求）

## 发现的方案

| 方案 | 类型 | 搜索量数据 | 认证要求 | 成本 | 批量效率 |
|------|------|-----------|---------|------|---------|
| Google Ads API | 官方 API | 有（月均搜索量+竞争度） | OAuth2 + Google Ads 账户 + Developer Token | 免费（需 Ads 账户） | 高 |
| Google Autocomplete API | 非官方免费 API | 无 | 无需认证 | 免费 | 极高 |
| 竞品关键词反查 | 竞品情报工具 | 有（且经过竞对验证） | 工具账号 | 免费/付费 | 极高 |
| SerpAPI / DataForSEO | 第三方付费 | 有 | API Key | 付费 | 高 |
| Selenium 爬 Keyword Planner | 爬虫 | 有 | Google 账号 | 免费 | 低，易封 |

## 方案 A：Google Ads API（推荐，需要搜索量时）

Google 官方 `KeywordPlanIdeaService.GenerateKeywordIdeas` 接口，和网页版 Keyword Planner 数据完全一致。

### 前置条件

- 一个 Google Ads 账户（可以 $0 花费，只要开通就行）
- 申请 Developer Token（Basic Access 就够）
- OAuth2 配置

### 官方资源

- 文档：https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas
- Python 库：https://github.com/googleads/google-ads-python
- 示例代码：`examples/planning/generate_keyword_ideas.py`

### 核心调用

```python
from google.ads.googleads.client import GoogleAdsClient

client = GoogleAdsClient.load_from_storage(version="v23")
service = client.get_service("KeywordPlanIdeaService")

request = client.get_type("GenerateKeywordIdeasRequest")
request.customer_id = "你的客户ID"
request.language = "languageConstants/1000"  # English
request.geo_target_constants = ["geoTargetConstants/2156"]  # China
request.keyword_plan_network = client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH
request.keyword_seed.keywords.extend(["种子词1", "种子词2"])

results = service.generate_keyword_ideas(request=request)
for idea in results:
    print(f"{idea.text} - 月均搜索量: {idea.keyword_idea_metrics.avg_monthly_searches}")
```

### Seed 类型

- `keyword_seed`：纯关键词列表
- `url_seed`：分析某个 URL 提取关键词
- `keyword_and_url_seed`：关键词 + URL 组合
- `site_seed`：整个域名（可返回最多 250,000 个建议）

### 返回数据

- `text`：建议关键词
- `avg_monthly_searches`：月均搜索量
- `competition`：竞争度（LOW / MEDIUM / HIGH）
- 支持分页

## 方案 B：Google Autocomplete API（推荐，只要扩展词时）

非官方但广泛使用的免费接口，KeywordTool.io、Ubersuggest 底层都用它。

### 接口

```
GET https://suggestqueries.google.com/complete/search?client=chrome&hl=zh-CN&gl=CN&q=关键词
```

### 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `q` | 查询词（URL编码） | `q=coffee` |
| `client` | 输出格式 | `chrome`(JSON), `toolbar`(XML), `firefox`(JSON) |
| `hl` | 语言 | `zh-CN`, `en` |
| `gl` | 国家 | `CN`, `US` |
| `ds` | 数据源 | `yt`(YouTube), 空(Google搜索) |

### 返回格式

```json
["coffee", ["coffee beans", "coffee near me", "coffee table"], [], {"google:suggestrelevance": [1250, 600, 560]}]
```

### 批量扩展技巧

每个种子词拼接 a-z，一个词变 26 次请求，每次返回 ~10 个建议，一个种子词可扩展 200+ 相关词：

```python
import requests
from urllib.parse import quote

def expand_keyword(seed, lang="zh-CN", country="CN"):
    results = set()
    for suffix in list("abcdefghijklmnopqrstuvwxyz") + [""]:
        q = f"{seed} {suffix}".strip()
        url = f"https://suggestqueries.google.com/complete/search?client=chrome&hl={lang}&gl={country}&q={quote(q)}"
        resp = requests.get(url)
        if resp.status_code == 200:
            suggestions = resp.json()[1]
            results.update(suggestions)
    return sorted(results)

# 批量处理
seeds = ["咖啡", "奶茶", "烘焙"]
for seed in seeds:
    keywords = expand_keyword(seed)
    print(f"{seed} → {len(keywords)} 个扩展词")
```

### 注意事项

- 无需认证，无官方限速（但过度请求可能被临时封 IP）
- 建议加 0.5-1s 延迟，或用代理池
- 不返回搜索量数据
- 非官方 API，可能随时变更

### 参考

- 完整规格：https://www.fullstackoptimization.com/a/google-autocomplete-google-suggest-unofficial-full-specification
- Pemavor 教程：https://www.pemavor.com/scrape-the-google-autosuggest-with-python/

## 方案 C：竞品关键词反查（推荐，SEM 投放场景最实用）

换个思路：不从种子词扩展，而是直接看竞对在投什么词、自然流量靠什么词。竞对已经帮你做了关键词筛选和验证，拿来即用。

### 核心逻辑

你要投 SEM 广告 → 你的竞对也在投 → 他们投的词就是经过预算验证的高价值词。

### 工具

| 工具 | 能力 | 成本 | API |
|------|------|------|-----|
| SimilarWeb | 竞对付费词 + 自然流量词 + 流量占比 | 免费版有限，Pro 付费 | 有 |
| SEMrush | 竞对关键词列表 + 搜索量 + CPC + 排名 + 广告文案 | 付费（$139/月起） | 有 |
| Ahrefs | 竞对自然词 + 付费词 + 关键词难度 | 付费（$129/月起） | 有 |
| SpyFu | 专注竞对广告情报，历史投放数据 | 付费（$39/月起） | 有 |

### 操作流程

1. 确定 3-5 个直接竞对的域名
2. 用 SimilarWeb / SEMrush 导出竞对的付费关键词列表
3. 交叉对比多个竞对的共同词 → 这些是行业核心词
4. 找出竞对投了但你没投的词 → 这些是增量机会
5. 按搜索量和 CPC 排序，优先投高搜索量低 CPC 的词

### 进阶：Google Ads Transparency 滚雪球法

利用 Google 官方的广告透明度中心（https://adstransparency.google.com/）反向发现竞对，形成关键词滚雪球：

```
种子关键词
  → Ads Transparency 搜索，找到所有投这个词的广告主
    → 得到一批竞对域名（比你自己知道的竞对更全面）
      → SimilarWeb / SEMrush 反查每个竞对的全部关键词
        → 得到大量新关键词
          → 用新关键词再回 Ads Transparency 找更多竞对
            → 循环，直到关键词池不再增长
```

Ads Transparency 本身也能直接看到竞对在投什么词和广告文案，是 Google 官方提供的公开数据，完全合规。

这个方法的核心价值：**你不需要事先知道竞对是谁**，只要有一个种子关键词就能发现整个竞争格局。

### 优势

- 关键词已经过竞对的预算验证，质量远高于盲目扩展
- 直接拿到搜索量、CPC、竞争度等数据
- 能发现自己想不到的长尾词
- 还能看到竞对的广告文案，辅助写广告

### 适用场景

- SEM 广告投放（最佳场景）
- SEO 内容规划
- 市场竞争分析

## 决策建议

| 场景 | 推荐方案 |
|------|---------|
| SEM 投放，想知道该投什么词 | 方案 C（竞品反查），竞对已帮你验证过 |
| 只要关键词扩展，不需要搜索量 | 方案 B（Autocomplete），零成本，5分钟写完脚本 |
| 需要搜索量 + 竞争度 | 方案 A（Google Ads API），需 1-2 小时配置 OAuth |
| 两个都要 | 先用 C 拿竞对词，再用 B 扩展，最后用 A 查搜索量 |

不建议爬网页版 Keyword Planner，维护成本高且容易被封。

## 搜索关键词记录

以下关键词已搜索过，避免重复调研：
- `Google Keyword Planner API programmatic access keyword ideas`
- `site:github.com google keyword planner api python bulk keywords`
- `google keyword planner alternative API free no google ads account`
- `google autocomplete suggestqueries endpoint keyword research bulk python`
- `github google-ads-python keyword plan example generate_keyword_ideas`
