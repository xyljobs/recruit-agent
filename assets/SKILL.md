---
name: candidate-analysis
version: 0.2.0
description: 根据 JD 或个性化招聘需求，自动在 Boss 直聘搜索候选人、爬取简历截图、深度分析后输出 HTML 候选人评估报告，并支持在报告里一键打开候选人简历原页面。当用户提到"找候选人"、"搜简历"、"招聘分析"、"Boss 直聘"、"打开候选人简历"或给出 JD 让你帮忙找人时使用。
enabled_at: 1782981145860
install_source: official
install_method: download
x-source: aone-open
name_zh: HR招聘搜索&分析
skill_id: 34c5d7e2-a27e-4ba7-bff0-eee7e4a20084
---

# candidate-analysis

把 HR 的 JD 转化为「精挑细选的候选人短名单 + 可点开看简历的 HTML 报告」。

## 工作流总览

```
JD ──▶ 关键词策略 ──▶ 爬取截图 ──▶ 深度分析 ──▶ HTML 报告 ──▶ 启动报告窗口
       Step 2~3      Step 4~5     Step 6      Step 6       Step 7
                                                              │
                                                              ▼
                                              用户在桌面窗口里点"查看简历"按钮
```

## 全局约束（贯穿所有步骤）

这四条是 skill 能正确工作的前提，违反任何一条都会导致功能损坏或账号被封：

1. **Boss 直聘的所有交互只能通过 `scripts/boss.py`**。它内部用 cloakbrowser（反指纹浏览器）维持登录态。**禁止**用 agent-browser、系统浏览器或任何其他爬虫工具直接访问 Boss 直聘——只要绕开 boss.py 就会被封。
2. **Step 7 必须执行**。报告窗口里的"查看简历"按钮依赖 PyWebView 进程，跳过这一步按钮就是死的。
3. **顺序执行，不并发**。一次只能跑一个 `boss.py search`，多任务并发会触发 Boss 风控。
4. **技术细节不暴露给用户**。HR 不需要知道"PyWebView""securityId""cloakbrowser"是什么，所有错误提示都要翻译成可操作的人话。

---

## Step 1 · 环境准备（仅首次）

**目标**：确保 uv、Python 依赖、Boss 登录态三件齐全。

**操作**：

```bash
# 1) uv 不在系统里就装一下
uv --version || curl -LsSf https://astral.sh/uv/install.sh | sh        # macOS/Linux
# Windows: powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 2) 同步依赖、检查环境
cd <skill_dir>/scripts
uv sync
uv run boss.py doctor
```

**判断分支**：

- doctor 提示登录态缺失 → 让用户跑 `uv run boss.py login`，扫码后按 Ctrl+C 关浏览器即可，登录态保存在 `~/.cloakbrowser_recruiter_data`，长期复用。
- doctor 通过 → 直接进 Step 2。

---

## Step 2 · 关键词策略

**目标**：把 JD 拆成 2~5 组**带城市的**搜索关键词，总候选人 20~40 人。

**核心原则**：

1. **城市必须作为关键词的第一个词**。例如"上海 Java高级开发"。`boss.py` 内部维护 35 个常用城市的编码表，会自动把首词识别为 `city` 参数提交给 Boss API；这样不会被左侧"地区"过滤器的历史选择干扰。用户没指定城市就别瞎加。
2. **每组关键词 5~10 人**。多了匹配度会快速下降，宁可多分几组关键词。
3. **关键词要有层次**：核心词（JD 标题直接转）+ 同义变体（如"后端开发"="服务端工程师"）+ 技术栈细分（如"微服务架构师""Spring Cloud开发"）。

**产出格式**（直接进入 Step 3 给用户看的也是这张表）：

| 关键词 | 数量 | 用途 |
|--------|------|------|
| 上海 Java高级开发 | 8 | 核心匹配 |
| 上海 后端开发工程师 | 6 | 同义变体 |
| 上海 微服务架构师 | 5 | 技术栈细分 |
| 上海 Spring Cloud开发 | 5 | 技术限定 |

---

## Step 3 · 用户确认

**目标**：搜索前让用户确认关键词策略，避免方向错误浪费一次搜索。

把 Step 2 的表格直接发给用户，附一句"总计预计爬取 N 人，确认开始？"。**收到明确肯定回复后才能进 Step 4**。如果用户提了调整意见，回到 Step 2 改完再确认。

---

## Step 4 · 旧数据处理

**目标**：保护历史数据，不误删。

**默认动作**：什么都不做。每次搜索 boss.py 会按时间戳生成新目录（`简历/<时间戳>/<关键词>/`），不覆盖任何旧数据。

**只有当**任务目录超过 5 个、用户明确要清理时，用 Python 脚本删除最旧的几份：

```python
import shutil; from pathlib import Path
for d in sorted((Path.cwd() / "简历").iterdir())[:-3]:
    shutil.rmtree(d)
```

**禁止用 `rm -rf`**——会触发系统确认框，打断 Agent 流程。

---

## Step 5 · 爬取候选人简历

**目标**：通过一次命令、一个浏览器会话跑完所有关键词，每个候选人保存多张完整简历截图。

**操作**：

```bash
cd <skill_dir>/scripts
uv run boss.py search "上海 Java高级开发" 8 "上海 后端开发工程师" 6 "上海 微服务架构师" 5
```

**结果解析**：从 stdout 中取 `===BATCH_RESULT_JSON===` 与 `===BATCH_RESULT_END===` 之间的 JSON：

| status | 含义 | Agent 应该做什么 |
|--------|------|------------------|
| `done` | 全部成功 | 进 Step 6 |
| `aborted` | 部分失败 | 用已抓到的部分继续 Step 6，告知用户哪些失败了 |
| `error` | 单次搜索失败（跳转/无结果/被风控） | 跳过该关键词，继续下一个；全失败才停 |
| `login_expired` | 登录态过期 | 立即停止，告诉用户"需要重新验证身份" |

**输出目录结构**：

```
scripts/简历/<时间戳>/
  <关键词>/
    01_姓名_geekId/1.png 2.png …    ← 每个候选人的完整简历截图
  manifest.json                       ← 含每人 global_index、geek_url
```

`manifest.json` 里每人都有：
- `global_index`：跨关键词不重复的全局编号，报告和 serve 服务都用它
- `geek_url`：含 securityId 的 Boss 简历 URL（serve 用它打开简历），约**当天有效**，隔天需要重新 search

---

## Step 6 · 生成 HTML 评估报告

**目标**：产出一份能让 HR 在 5 分钟内决定"这一批人值不值得跟进"的专业评估报告。

**关键工具**：模板 + 渲染器已经写好沉淀在 `scripts/` 下，**Agent 不要从 0 写 HTML/CSS**：

| 文件 | 作用 |
|------|------|
| `scripts/report_template.html` | HTML 骨架。包含：锚点导航、Hero、KPI、推荐分布条、**批次画像（年限分布/薪资×经验散点/公司层次堆叠/高频标签）**、**热力对比矩阵**、Top 推荐、完整候选人卡片（雷达图 + **职业轨迹时间线** + 详细分析）、市场观察五分区 |
| `scripts/render_report.py` | 把候选人数据填进模板生成 `report.html`。批次画像四张图全部从已有字段自动聚合（AI 不用多填），AI 只关心每人 dict 的写法。导出 `render_report()` 函数 |

Agent 只负责**两件事**：
1. **分析候选人**（看简历截图、打分、写一句话推荐）
2. **写一段 Python 代码调用 `render_report()`**（数据传字典，30~50 行/候选人）

### 6.1 分析每个候选人

**强制：逐人分析 + 截图先压缩**（违反会直接报 `image dimensions exceed max allowed size for many-image requests: 2000 pixels` 把整轮分析打断）：

1. **一次只读一个候选人的图**。不要在同一次工具调用里 `Read` 多个候选人的截图——many-image 请求里每张图长边都不能超过 2000px，多人混读极易触发上限错误。读完一个人 → 在脑里写完该人的六维打分和文案 → 再读下一个人。
2. **读图前先批量压缩**。每位候选人的多张截图（`1.png 2.png …`）通常会超过 2000px，必须先用下面这段脚本把所有 png 等比缩放到长边 ≤ 1800px（留 200px 余量）再交给 Read 工具：

   ```bash
   cd <任务目录>
   uv run --with pillow python - <<'PY'
   from pathlib import Path
   from PIL import Image
   MAX = 1800
   for p in Path('.').rglob('*.png'):
       with Image.open(p) as im:
           w, h = im.size
           if max(w, h) <= MAX:
               continue
           s = MAX / max(w, h)
           im.resize((int(w*s), int(h*s)), Image.LANCZOS).save(p, optimize=True)
           print(f'shrunk {p}: {w}x{h} -> {int(w*s)}x{int(h*s)}')
   PY
   ```

   只压一次、原地覆盖（已经是 boss.py 的产物，截图本身没有归档需求）。压完之后再开始逐人 Read。
3. **同一人的多张图可以一次 Read**（同一人的图组通常 3~6 张，压缩后总尺寸不会撑爆）。但**跨人不要混读**。
4. **如果还是报 2000px 错**：把 `MAX` 调到 1568（Anthropic 官方推荐分辨率）再压一次；或者把那个人的图分两批读。

完成压缩并按上面的方式逐人读完截图后，按下面六维打分（每维 0~100）：

| # | 维度 | 评估什么 |
|---|------|----------|
| 1 | 硬性匹配 | 工作年限、学历、地域、薪资是否在 JD 范围 |
| 2 | 技术深度 | 核心技术栈掌握程度、广度、稀缺技能 |
| 3 | 业务经验 | 行业相关性、项目规模、有无标杆项目 |
| 4 | 职业轨迹 | 职级成长速度、公司层次递进 |
| 5 | 稳定性 | 平均在职时长、跳槽频率、空窗期 |
| 6 | 综合潜力 | 学习能力、跨领域能力、管理潜力、稀缺度 |

每维要有具体分数 + 理由（理由用在亮点/风险/面试重点里）。综合评分按 JD 侧重点动态加权，不要简单平均。每位候选人额外给出：一句话亮点、一句话风险、面试重点、最匹配/最不匹配点。

**推荐等级（决定徽章颜色）**：
- `strong`（绿）—— 强烈推荐：硬性全部命中 + 综合 ≥85
- `rec`（蓝）—— 推荐：综合 75~84，主要项命中
- `maybe`（橙）—— 可考虑：综合 65~74，有亮点但有明显短板
- `no`（灰）—— 不推荐：综合 <65 或硬性卡死（如经验不足、岗位错位）

### 6.2 调用渲染器生成报告

**写一个 Python 脚本**（保存到任务目录下，例如 `gen_report.py`），结构如下：

```python
# gen_report.py
import sys
sys.path.insert(0, "<skill_dir>/scripts")  # 把 scripts 目录加入 import 路径
from render_report import render_report

candidates = [
    {
        "global_index": 1,                        # 来自 manifest.json
        "name": "马**", "age": 32, "years": 9, "edu": "本科",
        "salary": "35-65K",
        "company_title": "腾讯云国际站 · 高级前端开发",
        "level": "rec",                           # strong/rec/maybe/no
        "overall": 80,                            # 综合分 0-100
        "one_liner": "腾讯云国际站高级前端，主导 SSR/Node BFF/Monorepo/微前端...",
        "tags": ["腾讯大厂", "Node BFF", "Monorepo", "性能优化"],
        "scores": [62, 92, 88, 85, 72, 85],       # 六维分数（顺序固定）
        "highlight": "...",                       # 亮点详述（一段话）
        "risk": "...",                            # 风险（一段话）
        "interview": "...",                       # 面试重点（一段话）
        "best_match": "...",                      # 最匹配 JD 的点
        "worst_match": "...",                     # 最不匹配的点
        # 可选：职业轨迹时间线（按时间正序，最近的放最后）
        # tier 取值: big(大厂) / mid(中厂/国企) / small(小厂) / startup(创业) / gap(空窗)
        "timeline": [
            {"company": "某创业公司", "months": 18, "tier": "startup"},
            {"company": "美团",       "months": 30, "tier": "big"},
            {"company": "腾讯",       "months": 60, "tier": "big"},
        ],
    },
    # ... 其他候选人
]

meta = {
    "title": "高级前端开发工程师（React+TS）候选人评估",
    "subtitle": "上海 · 25-35K · 14薪 · 3 年以上 · 本科+",
    "jd_highlights": "React 精通、TypeScript、工程化、BAT/字节加分...",
    "keywords": "上海 高级前端 · 上海 React · 上海 前端架构师",
    "exec_time": "2026-06-15",
    # 市场观察 5 段（每段 1~3 句话，写干货不写虚话）
    "insight_supply": "本批候选人...（供给结构：年限/学历/公司层次概览）",
    "insight_intent": "...（求职意愿：在职/离职、跳槽频率、稳定性观察）",
    "insight_salary": "...（薪资水位：与 JD 预算对比，是否需要调整）",
    "insight_risk":   "...（风险信号：行业错配、空窗、频繁跳槽等）",
    "insight_next":   "① 优先联系 X，因为... ② 对 Y 先电话摸底... ③ ...（编号的 HR 行动）",
}

render_report(
    meta=meta, candidates=candidates,
    invalid_count=4,                              # manifest 中 status=failed 的人数
    invalid_reason="另有 4 人简历不全或爬取失败，未列入评估",
    output="report.html",                         # 保存到任务目录下
)
```

跑一下：`cd <任务目录> && uv run python gen_report.py`，产出 `report.html`。

**产出 `report.html` 后立即进 Step 7，不要停下问用户"要不要打开"——一气呵成是默认行为。**

### 6.3 报告内容铁律（防止视觉混乱、信息缺失）

模板已经把视觉规范、雷达图、热力矩阵、批次画像、轨迹时间线全部内置，Agent 只需要保证**数据层**做到：

1. **第一屏决断**。Hero + KPI + 推荐分布 + 批次画像（年限分布/薪资×经验散点/公司层次/标签）已经在模板顶部，把推荐等级分对（strong/rec/maybe/no），第一屏自然就能让 HR 决断。
2. **完整覆盖**：每位有效候选人都要有一个完整 dict（不要漏 highlight/risk/interview）。爬取失败的人写到 `invalid_count` 和 `invalid_reason` 里，不要默默丢弃。
3. **批次画像零成本**：4 张图（年限直方图、薪资散点、公司层次堆叠、Top 标签）全部从已有字段（years/salary/tags/company_title/timeline）自动聚合，AI 不用单独传画像数据。
4. **timeline 字段强烈建议传**：让 HR 一图看完跳槽节奏；按时间正序，最近一段放最后；tier 取 big/mid/small/startup/gap 五选一。漏掉就只是少了时间线，其他不影响。
5. **对比矩阵热力上色**：六维分数 ≥80 自动绿、60~79 黄、<60 红——所以打分要严肃，不要怕给低分。
6. **Top 推荐自动选**：渲染器按 `level` + `overall` 排序，自动取前 3 人放 Top 区，剩下的 strong/rec 会下沉到"可考虑"区上方（不重复）。
7. **市场观察 5 段都要写**：供给结构 / 求职意愿 / 薪资水位 / 风险信号 / 下一步动作。`insight_next` 必须给出**编号的 HR 行动建议**（① 优先联系 X，因为... ② 对 Y 先电话摸底...），不要写虚话。

### 6.4 数据填充常见错误

- ❌ `level` 写成 `"yes"/"no"`：必须是 `strong/rec/maybe/no` 四选一
- ❌ `scores` 长度不是 6：必须严格按"硬性/技术/业务/轨迹/稳定/潜力"6 个维度
- ❌ `tags` 里堆 emoji：标签是文字短语，不是 🔥💯
- ❌ 把 manifest 字段直接 dump 给 `one_liner`：`one_liner` 要重写成人话，一句话能让 HR 记住这个人
- ❌ `global_index` 跟 manifest 对不上：必须用 manifest.json 里每人的 `global_index`，否则查看简历按钮会打开错的人
- ❌ `timeline` 的 tier 写错（写成"大厂""tencent"等）：只能是 `big/mid/small/startup/gap`
- ❌ 漏写 `insight_salary` / `insight_risk`：会显示空白板块，看起来不专业

## Step 7 · 启动报告窗口

**目标**：让用户在桌面窗口里看到报告，每个"查看简历"按钮都真的能点开 Boss 简历。

**何时执行**：
- **Step 6 生成完 `report.html` 后立即自动执行**，不询问用户。
- 用户后续说"打开报告"/"再看一下"/"看报告"等话术时也走这一步（Agent 行为规范见下）。

**操作（推荐 PyWebView 桌面模式）**：

```bash
cd <skill_dir>/scripts
uv run boss.py report <任务目录>
```

会弹出一个 1280×900 的桌面窗口加载报告 HTML，按钮直接通过 PyWebView bridge 调 cloakbrowser，**没有 HTTP 服务、没有端口、没有 CORS**。关闭窗口 = 自动清理后端浏览器，生命周期清晰。

**底层原理**（Agent 内部理解，不要告诉用户）：

```
用户 ──点按钮──▶ window.pywebview.api.open_resume(idx)
                         │
                         ▼
                 boss.py ReportApi.open_resume
                         │
                         ▼
                 cloakbrowser route 拦截 + 卡片点击
                         │
                         ▼
                Boss 简历模态弹出
```

**异常处理速查表**（用户看到错就照这一栏的话回复，自己静默修复）：

| 用户看到 | Agent 该做什么 |
|----------|---------------|
| 按钮显示 "✗ no_geek_url" 或 "✗ candidate_not_found" | 链接已失效，重新跑 `boss.py search` 拿新的 securityId |
| 按钮显示 "✗ login_expired" | 跑 `boss.py login`，告诉用户"需要重新扫码登录一下" |
| 窗口闪退 / 没弹出来 | 重新跑 `boss.py report`，不告诉用户技术细节 |
| 窗口里状态条显示"简历查看功能未就绪…" | 这是 HTTP 模式 fallback 才会显示，PyWebView 模式会直接显示"桌面模式·就绪"。出现说明 pywebview 没装好，跑 `uv sync` 重装 |

**报告交付话术**（自然简短，不带技术词）：

> 已为你生成「候选人评估报告应用」，在里面点“查看简历”就能直接打开候选人简历联系他。
>
> 如果关了想再看，跟我说“启动报告”或“打开报告”就重新弹出来。

**Agent 行为规范（当用户说“启动报告”/“打开报告”/“看报告”/“再看一下”时）**：

1. **检测报告窗口是否已在运行**：看后台是否有 `boss.py report` 进程正在跑（用 `pgrep -f "boss.py report"` 检查）。
2. **已在运行**：直接告诉用户"报告应用还开着，切换过去就行"，不重复启动。
3. **没在运行**：自动跑 `uv run boss.py report <最新任务目录>` 启动，不问用户确认。说一句"帮你重新启动了报告应用 → 应该一会出现在桌面"。
4. **如果启动失败**（比如找不到报告 HTML）：告诉用户"需要先搜索一批候选人再生成报告"，引导回 Step 2。
5. **不要让用户手动输入路径**。Agent 自动找 `scripts/简历/` 下最新的时间戳目录。
6. **不要暴露“PyWebView/进程/端口”这种技术词**。对用户只需说"报告应用"。

**兼容旧 HTTP 模式（仅当用户明确要求"在系统浏览器看"或 PyWebView 跑不起来时用）**：

```bash
uv run boss.py serve <任务目录> &
open http://localhost:9876
```

报告模板会自动检测当前在不在 PyWebView 里——是就直接调 `pywebview.api`，不是就 fallback 到 fetch HTTP，**同一份 HTML 两种模式都能跑**。

---

## 反模式速查（这些做了报告就废了）

- ❌ 用 agent-browser 或系统浏览器打开 Boss 直聘 → 立即被封
- ❌ 跳过 Step 7 直接交付 HTML → 按钮死的，HR 用不了
- ❌ 不同候选人卡片用不同结构/不同板块 → 报告看起来杂乱
- ❌ 把 manifest 的 JSON 字段原样贴到报告里 → 不是给开发看的
- ❌ 用 🌟✨🔥 之类表情符号当装饰 → 不专业
- ❌ 用户明明指定了城市却没把城市作为关键词首词 → 搜出来地域错配
- ❌ 一次跑多个 search 命令并发 → 触发风控
- ❌ 用 `boss.py serve` 而不用 `boss.py report` → 体验降级，要 HR 切到系统浏览器才能用
- ❌ 一次 Read 多个候选人的截图 → many-image 请求超 2000px 上限报错，整轮分析中断；必须逐人读
- ❌ 直接 Read 原始截图不压缩 → 大概率触发 2000px 上限；分析前先跑 6.1 的 Pillow 压缩脚本

## 隐私

候选人姓名 Boss 默认会脱敏（如 "张**"），保持原样即可。如果偶发出现完整姓名，按脱敏处理。
