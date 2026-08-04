# 项目上下文

## 项目概述

**智聘Agent人才智能匹配系统** - 一款可私有部署的 AI 驱动 HR 招聘决策副驾驶，帮助 HR 高效完成 JD 解析、候选人匹配、短名单决策、沟通话术生成、结果复盘和外部渠道（Boss直聘）候选人搜索。默认以纯规则模式（`AI_EXECUTION_MODE=rules_only`）运行，AI 能力需经部署级 + 租户级双重审批后方可启用。

## 核心功能

1. **JD智能解析** - 输入职位描述，AI 自动提取结构化需求卡片
2. **候选人管理** - 候选人信息录入、加密存储、授权与权利管理
3. **智能匹配** - 规则预筛 + LLM 深度分析双层评分（技能/经验/学历/综合），支持批量短名单
4. **短名单决策** - 匹配结果进入短名单，支持逐条决策与理由留痕
5. **话术生成** - 基于匹配结果与本地话术知识库生成个性化沟通话术
6. **状态看板与结果复盘** - 招聘流程状态管理（待接触/已联系/面试中/已录用等）+ outcomes 结果追踪与校准（calibration）
7. **Boss直聘搜索** - 云端入队 + 本地 Worker 执行的候选人搜索与报告
8. **简历批处理** - 批量简历解析入库流水线（含扫描版 PDF 视觉模型支持，默认关闭外部分析）
9. **AI 执行边界治理** - rules_only / private_endpoint / approved_cloud 三档执行模式，租户级审批 + 去标识化载荷

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5（strict）
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **Database**: Supabase (PostgreSQL，可 Docker 自托管)
- **AI**: OpenAI 兼容抽象层（默认阿里云百炼 `qwen-plus`，模型可经 `LLM_MODEL` 切换），本地 Markdown 知识库检索，AI 执行边界分级（见 `.env.example` 中 `AI_EXECUTION_MODE`）
- **包管理器**: pnpm 9+（`preinstall` 拦截 npm/yarn）

## 目录结构

```
├── public/                 # 静态资源（含 demo-guide.html 演示指南）
├── docs/                   # 部署与方案文档（独立部署指南、数据库安装步骤等）
├── assets/                 # 知识库 md、Boss Worker (Python)、简历批处理流水线、报告模板
│   ├── 知识库-IT技能图谱.md / 知识库-沟通话术模板库.md
│   ├── boss.py / boss_worker.py          # Boss直聘搜索 Worker
│   ├── resume_batch_pipeline.py 等        # 简历批处理
│   └── tests/                            # Python unittest
├── scripts/                # 迁移、种子数据、管理员初始化、Worker、启动与测试脚本
├── src/
│   ├── app/                # 页面路由与API
│   │   ├── (workspace)/    # analytics / candidates / data-sources / jobs / matching / outcomes / pipeline / shortlists
│   │   ├── api/            # 后端API路由（按域分组见下）
│   │   ├── boss-search/    # Boss搜索页
│   │   ├── resume-batch/   # 简历批处理页
│   │   ├── login/ change-password/ security/  # 认证与安全
│   │   ├── globals.css     # 全局样式
│   │   └── layout.tsx      # 根布局
│   ├── features/workspace/ # 工作区特性模块（components / hooks / lib / types）
│   ├── instrumentation.ts  # 启动时校验生产表存在，缺失即要求执行 migrate.sql
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── lib/                # 领域库
│   │   ├── ai/             # LLM 抽象层(llm.ts)、知识库(knowledge.ts)、执行策略(execution-policy.ts)、网关(gateway.ts)
│   │   ├── matching/       # 评分、短名单、置信度
│   │   ├── privacy/        # 授权与候选人权利
│   │   ├── integrations/   # ATS 集成、webhook、CSV 写回
│   │   ├── metrics/ recruiting/           # 决策指标、沟通摘要
│   │   ├── encryption.ts / totp.ts / rate-limit.ts 等  # 安全基础设施
│   │   └── utils.ts        # 通用工具函数 (cn)
│   ├── server.ts           # 自定义服务器入口（Node http + Next.js）
│   └── storage/database/   # Supabase 客户端封装
├── DESIGN.md               # 设计规范
├── Dockerfile / docker-compose.yml  # 容器化部署（含 test compose）
├── next.config.ts          # Next.js 配置（standalone 输出）
└── package.json            # 项目依赖管理
```

## 数据库模型（完整定义见 `scripts/migrate.sql`）

### 核心业务域
- **job_requirements** (职位需求): title, department, location, salary_range, experience_required, education_required, skills_required[], responsibilities[], benefits[], raw_jd, status
- **candidates** (候选人): 加密字段(name/email/phone/current_company/current_position) + HMAC 索引，skills[], experience_years, education, resume_text, 授权与权利字段
- **match_records** (匹配记录): job_id/candidate_id FK，overall/skill/experience/education 四维评分，match_details (JSONB: strengths/gaps/recommendations), status, status_history[], generated_script
- **match runs / shortlists / shortlist entries / decisions**: 批量匹配运行版本、短名单与逐条决策留痕
- **outcomes / calibration**: 结果追踪与评分校准

### 平台域
- **organizations / users / auth_sessions / invitations**: 多租户、登录、MFA、邀请
- **integrations / writebacks**: ATS 集成与出站写回（精确主机白名单）
- **boss_search_tasks**: Boss搜索任务队列（租约认领机制）
- **resume_batch_***: 简历批处理任务与状态

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**（`preinstall` 强制校验）。

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码
- 禁止隐式 `any` 和 `as any`
- 函数参数、返回值、解构项、事件对象在使用前应有明确类型

### API规范

- 查询类接口遵循 RESTful 惯例（GET 读取 / POST 创建与动作 / PATCH 更新），请求体为 JSON
- 返回格式统一为 `{ success: boolean, data?: T, error?: string }`
- LLM调用使用流式输出 (`client.stream()`)，统一经 `AiExecutionGateway` 出口，禁止绕过执行策略直连模型
- 错误必须throw，禁止console.error后继续

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用动态数据
2. **禁止使用 head 标签**，优先使用 metadata
3. 三方 CSS、字体在 `globals.css` 中通过 `@import` 引入

## API接口清单（按域分组）

| 域 | 接口 | 功能 |
|------|------|------|
| 认证 | /api/auth/login · logout · register · me · change-password · mfa · invitations | 登录/登出/注册/MFA/邀请 |
| JD与职位 | /api/jd/parse (POST) · /api/jobs (GET) | JD智能解析、职位列表 |
| 候选人 | /api/candidates (GET/POST) · /api/candidates/[id]/revoke · decision-rights | 候选人CRUD、授权撤回与决策权 |
| 匹配 | /api/match (POST) · /api/match/batch · /api/match-records (GET/PATCH) | 单人深度匹配、批量预筛、记录管理 |
| 短名单 | /api/shortlists · [runId] · [runId]/entries/[entryId]/decision | 短名单与逐条决策 |
| 话术与搜索 | /api/script/generate (POST) · /api/search | 沟通话术生成、候选人搜索 |
| Boss搜索 | /api/boss-search/keywords · execute · status · report · contact · tasks/[taskId]/* | 关键词生成、任务入队、状态、报告、简历文件 |
| 简历批处理 | /api/resume-batch/presets · status · submit · admin | 批处理预设、提交、状态、管理 |
| 结果复盘 | /api/outcomes · /api/calibration · /api/decision-metrics | 结果录入、校准、决策指标 |
| 集成 | /api/integrations · [connectionId]/sync · writebacks · webhook/[connectionId] | ATS 集成、同步、写回、webhook |
| 看板与合规 | /api/dashboard (GET) · /api/candidate-rights-requests | 看板统计、候选人权利请求 |

## AI 执行边界（核心架构）

- 三档模式（`AI_EXECUTION_MODE`）：`rules_only`（默认，不调用任何模型/知识服务）/ `private_endpoint`（企业私有兼容端点）/ `approved_cloud`（经批准的外部端点，仅发送去标识化载荷）
- 部署模式只是能力上限；每个租户（organization）还须在"数据源"页由管理员逐项批准 `approved_cloud_processors`，未批准自动降级为 `rules_only`（见 `src/lib/ai/gateway.ts` 的 `createTenantAiExecutionGateway`）
- LLM 抽象层 `src/lib/ai/llm.ts` 基于 `openai` SDK，默认阿里云百炼 OpenAI 兼容端点（`qwen-plus`），无平台专属 SDK 依赖
- 知识库 `src/lib/ai/knowledge.ts` 完全本地：读取 `assets/` 下 2 个 md（IT技能图谱 / 沟通话术模板库），内存缓存 + 本地分块检索，无外部检索服务
- 候选人报告默认本地分析（`CANDIDATE_REPORT_MODE=local`）；简历批处理的外部模型分析需显式开启 `ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS=true`

## Boss直聘搜索架构

### Web端/本地分工
- **Web 应用端（Next.js）**：生成关键词(LLM)、创建任务(Supabase)、轮询状态、展示结果
- **本地Worker**(`assets/boss_worker.py`)：认领任务、登录Boss、执行boss.py search、解析manifest、更新状态、打开报告

### boss_search_tasks 表
- 状态流转: `pending` -> `running` -> `done`/`error`/`login_required`
- Worker通过`lease_until`租约机制认领任务，防止并发
- `report_requested`标志位通知Worker打开HTML报告

### 本地Worker启动
```bash
cd assets
cp .env.worker.example .env.worker  # 填入Supabase凭证
uv run boss.py login                 # 首次登录Boss直聘
uv run boss_worker.py                # 启动Worker(持续轮询)
uv run boss_worker.py --once         # 单次模式(处理一个任务后退出)
```

## 状态枚举

### 招聘状态 (match_records.status)
- `pending` - 待接触
- `contacted` - 已联系
- `interviewing` - 面试中
- `offered` - 已发Offer
- `hired` - 已录用
- `rejected` - 已拒绝
- `withdrawn` - 已撤回

### 评分色彩规则
- 90-100: emerald (优秀)
- 70-89: blue (良好)
- 50-69: amber (一般)
- 0-49: red (不匹配)

## UI 设计与组件规范

- 使用 shadcn/ui 组件，位于 `src/components/ui/`
- 主色调: #3B82F6 (blue-500)
- 布局: workspace 路由组 + 导航切换，页面按功能域拆分（analytics/candidates/jobs/matching/shortlists/pipeline/outcomes/data-sources）
- 最大宽度: 1440px

## 部署前置条件

### 1. 环境变量（必须）

复制 `.env.example` 为 `.env.local`，填入真实值：

| 变量 | 必须 | 说明 |
|------|------|------|
| `SUPABASE_URL` | 是 | Supabase 项目 URL（官方云或 Docker 自托管，如 `http://localhost:8000`） |
| `SUPABASE_ANON_KEY` | 是 | Supabase 匿名 Key |
| `SUPABASE_SERVICE_ROLE_KEY` | 是 | 一次性管理员初始化及服务端管理操作需要 |
| `PGDATABASE_URL` | 是 | 数据库迁移用 PostgreSQL 直连地址 |
| `ENCRYPTION_KEY` | 是 | AES-256-GCM 加密密钥（64位hex） |
| `HMAC_KEY` | 是 | HMAC-SHA256 签名密钥（64位hex） |
| `JWT_SECRET` | 是 | 应用登录 JWT 密钥 |
| `SUPABASE_JWT_SECRET` | 是 | 与 Supabase 运行环境一致，服务端签发短期 RLS 令牌 |
| `AI_EXECUTION_MODE` | 推荐 | `rules_only`(默认) / `private_endpoint` / `approved_cloud` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 启用AI时 | OpenAI 兼容端点，默认阿里云百炼 `qwen-plus` |
| `APP_URL` / `PORT` | 推荐 | 部署地址与端口（默认 5000） |

### 2. 数据库初始化（必须）

1. 执行迁移：`pnpm db:migrate`（或手动在 Supabase SQL Editor 执行 `scripts/migrate.sql`）
2. 通过部署平台临时注入 `BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD`、`BOOTSTRAP_ORGANIZATION_NAME`、`BOOTSTRAP_ORGANIZATION_SLUG`，运行 `pnpm admin:bootstrap`；成功后立即删除这些 Secret
3. 运行 `pnpm seed:demo` 插入演示数据（5位候选人 + 多个职位）

> 管理员初始化命令只允许在尚无管理员时执行。初始密码至少 12 位，且首次登录必须修改；禁止重新使用历史演示邮箱。

### 3. AI 服务依赖

- LLM 经 `src/lib/ai/llm.ts` 抽象层直连 OpenAI 兼容端点（默认阿里云百炼 `qwen-plus`），无平台专属 SDK 依赖；`rules_only` 模式下完全不调用外部模型
- 知识库检索完全本地（`assets/` 下 3 个 md 分块检索），无外部检索服务依赖
- 云端模型能力需部署级 + 租户级双重审批，且仅发送去标识化载荷

### 4. 构建与质量门禁

- `dev` / `build` / `start` 均为跨平台 npm scripts（`next dev -p 5000` / `next build` / `node scripts/start.mjs`），Windows 无需 Git Bash；`scripts/` 下保留 `.sh` 版本供 Linux 环境兼容
- 质量门禁：`pnpm validate`（tsc + eslint --quiet）、`pnpm test`（TS 单测 `tsx --test` + DB 集成测试）、`pnpm build`、Worker 侧 `uv` unittest
- Docker：`Dockerfile` + `docker-compose.yml`（secrets 文件注入），`next.config.ts` 已启用 `output: 'standalone'`

## 演示前检查清单

- [ ] `.env.local` 已配置所有必须环境变量（含安全密钥与 `SUPABASE_JWT_SECRET`）
- [ ] Supabase 数据库已执行迁移（`pnpm db:migrate`），启动无缺表报错
- [ ] 已通过一次性 CLI 创建管理员并完成首次改密
- [ ] 演示数据已插入（`pnpm seed:demo`）
- [ ] 服务启动成功，5000 端口可访问
- [ ] 使用部署时创建的管理员账号登录正常（MFA 流程如启用需验证）
- [ ] AI 执行模式与演示意图一致（演示 LLM 能力需配好 `LLM_API_KEY` 并完成租户审批）
- [ ] JD 解析 AI 功能可用（LLM 服务连通）
- [ ] 候选人搜索返回已授权数据
- [ ] 智能匹配（单人深度 + 批量预筛）和话术生成正常
- [ ] 短名单决策、状态看板、结果复盘数据展示正确
- [ ] 演示指南页面可访问（/demo-guide.html）

## 已知限制

- **批量匹配**：使用规则启发式评分（快速预筛），单人匹配走 LLM 深度分析
- **候选人搜索**：加密字段（name/email/phone/company/position）不支持数据库层模糊搜索，通过 HMAC 精确匹配 + 非加密字段过滤
- **知识库检索**：本地 markdown 分块检索（非向量检索），知识库体量增大后需升级 pgvector 方案
- **Boss直聘接入**：依赖本地 Worker + 浏览器 GUI 扫码登录，任务与账号绑定在部署方自有环境
- **外部招聘平台**：当前搜索基于内部候选人库与 Boss Worker，集成层（integrations/webhook）已预留 ATS 写回扩展能力
