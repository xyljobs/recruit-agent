# 智聘Agent

![CI](https://github.com/xyljobs/zhipin-agent/actions/workflows/ci.yml/badge.svg) ![License](https://img.shields.io/github/license/xyljobs/zhipin-agent)

基于 Next.js 16 的企业私有部署招聘决策副驾驶，面向工业制造与 IT 外包等人力密集行业的人才供应链场景。系统接入现有 ATS 或已授权简历源，帮助 HR 生成可解释短名单、记录人工判断、准备沟通并用真实招聘结果持续校准。它不是完整 ATS，也不会自动拒绝、发 Offer 或录用候选人。

默认 `AI_EXECUTION_MODE=rules_only`，不调用模型或知识服务。部署模式只是能力上限，每个企业仍须由管理员在“数据源”页单独批准；只有逐项批准 `APPROVED_CLOUD_PROCESSORS` 且启用去标识化后，才可使用经批准的云端模型。

## 快速开始

1. 按 [Mac mini M4 数据库安装步骤](docs/Mac-mini-M4数据库安装步骤.md) 启动自托管 Supabase。
2. 复制 `.env.example` 为 `.env.local`，填写 Supabase 和安全密钥；仅在显式启用模型模式时配置对应模型端点与密钥。
3. 初始化并启动应用：

```bash
pnpm install
pnpm db:migrate
pnpm admin:bootstrap
pnpm seed:demo
pnpm dev
```

`admin:bootstrap` 仅用于创建首个组织管理员。执行时临时注入 `.env.example`
中列出的 `BOOTSTRAP_ADMIN_*` 和 `BOOTSTRAP_ORGANIZATION_*` 变量，成功后立即删除。

启动后访问 [http://localhost:5000](http://localhost:5000)。生产构建使用：

```bash
pnpm build
pnpm start
```

Docker 部署不会把整份 `.env.local` 注入容器。先将以下密钥分别写入
`secrets/` 下的同名文件（每个文件只保存密钥值）：

```text
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
LLM_API_KEY
ENCRYPTION_KEY
HMAC_KEY
JWT_SECRET
SUPABASE_JWT_SECRET
```

`.env.local` 仅用于 Compose 插值非敏感配置；确保其中的 `SUPABASE_URL`
在容器内可达，Mac 上连接宿主机 Supabase 时使用
`http://host.docker.internal:8000`。然后运行：

```bash
docker compose --env-file .env.local up --build
```

`scripts/init-db.sh` 只执行迁移。管理员初始化和演示数据灌入必须分别显式执行，
避免生产容器因残留环境变量自动创建管理员或写入演示数据。

本地 Worker 独立运行：复制 `assets/.env.worker.example` 为 `assets/.env.worker`，然后在 `assets` 目录分别执行：

```bash
uv run boss_worker.py
uv run resume_batch_worker.py
```

批量匹配使用数据库任务队列。非 Docker 部署还需在项目根目录启动匹配 Worker：

```bash
pnpm worker:match
pnpm worker:integration
```

Docker Compose 已包含 `match-worker` 和 `integration-worker` 服务。结果事件与 ATS 回写意图可在同一数据库事务中提交，真正的外部 HTTPS 调用只由 Worker 异步执行；目标主机必须精确列入 `INTEGRATION_OUTBOUND_ALLOWED_HOSTS`，为空时全部拒绝。部署本版本前必须重新运行 `pnpm db:migrate`，以创建短名单、结果事件、数据接入、事务回写和决策指标所需对象。

CSV/JSON 基线既支持把外部 ID 映射到已有实体，也支持直接导入新实体。新职位必须提供 `data.title`；新候选人必须同时提供 `data` 和完整 `authorization`，敏感字段会在入库前加密。CSV 使用 `data_json`、`authorization_json` 两列承载相同结构。每页最多 100 条，实体、映射与同步游标在同一事务提交。

提交前质量门禁：

```bash
pnpm validate
pnpm test
pnpm build
pnpm worker:build
cd assets && uv run --locked python -m unittest discover -s tests -v
```

数据库测试会使用仓库自带的临时 PostgreSQL 配置，覆盖迁移幂等、RLS、完整决策流程、真实导入、原子回写、最强清理和 100 候选人性能包络，不依赖开发者数据库凭证。

## 核心工作流与指标

1. 在“职位与标准”确认岗位要求并发起短名单。
2. 在“候选人短名单”查看证据、缺失信息和证据充分度；由 HR 明确接受、要求补充或覆盖推荐。
3. 只有最新人工结论为“已接受”的候选人才可准备沟通 brief。
4. 在“沟通与结果”记录触达、回复、面试、Offer、录用、撤回和投诉等真实事件。
5. “决策看板”展示合格面试数、首份合格短名单耗时、人工接受/覆盖、回复与后续转化、撤回/投诉及隐私处理 SLA；零分母显示“待积累”，不使用平均模型分冒充业务结果。

AI 分数只参与排序。每条推荐保存版本化置信度拆解、结构化证据、缺失信息和人工覆盖原因；所有结果事件追加保存，普通用户不能改写历史。

简历批处理首次部署与钉钉 MCP 配置见
[简历批处理与钉钉写回部署说明](docs/简历批处理与钉钉写回部署说明.md)。

## 项目结构

```
├── public/                  # 静态资源（含 demo-guide.html 演示指南）
├── docs/                    # 部署与方案文档
├── assets/                  # 本地知识库 md、Boss/简历批处理 Python Worker、报告模板、unittest
├── scripts/                 # 迁移、种子数据、管理员初始化、Worker、启动与测试脚本
├── src/
│   ├── app/                 # 页面路由与 API
│   │   ├── (workspace)/     # analytics / candidates / data-sources / jobs / matching / outcomes / pipeline / shortlists
│   │   ├── api/             # 后端 API（认证、匹配、短名单、集成、Boss 搜索、简历批处理等）
│   │   ├── boss-search/     # Boss 搜索页
│   │   └── resume-batch/    # 简历批处理页
│   ├── features/workspace/  # 工作区特性模块（components / hooks / lib / types）
│   ├── lib/
│   │   ├── ai/              # LLM 抽象层、本地知识库、执行策略、AI 网关
│   │   ├── matching/        # 评分、短名单、置信度
│   │   ├── privacy/         # 授权与候选人权利
│   │   └── integrations/    # ATS 集成、webhook、CSV 写回
│   └── storage/database/    # Supabase 客户端封装
├── Dockerfile / docker-compose.yml
└── scripts/migrate.sql      # 生产数据库完整定义
```

## AI 执行边界

- `rules_only`（默认）：不调用任何模型或知识服务，全部能力由规则引擎承载。
- `private_endpoint`：企业私有 OpenAI 兼容端点。
- `approved_cloud`：经批准的外部端点，且仅发送去标识化载荷（不含姓名、联系方式、公司名、原始简历）。
- 部署模式只是能力上限；每个租户还须在“数据源”页由管理员逐项批准后方可启用，未批准自动降级为 `rules_only`。
- 知识库完全本地：`assets/` 下 Markdown 分块检索，无外部检索服务。

## 质量门禁

```bash
pnpm validate   # tsc + eslint --quiet
pnpm test       # TS 单测（node:test）+ 数据库集成测试（docker compose）
pnpm build
cd assets && uv run --locked python -m unittest discover -s tests -v
```

GitHub Actions 对每次推送运行 `validate` + 单元测试 + Python Worker 测试。

## 技术栈

- **框架**: Next.js 16 (App Router) + React 19 + TypeScript 5 (strict)
- **UI**: shadcn/ui (Radix UI) + Tailwind CSS 4
- **数据库**: Supabase (PostgreSQL，可 Docker 自托管)
- **AI**: OpenAI 兼容抽象层（默认阿里云百炼 `qwen-plus`），本地 Markdown 知识库
- **Worker**: Python（uv 管理）——Boss 直聘搜索与简历批处理
- **包管理器**: pnpm 9+（`preinstall` 拦截 npm/yarn）

## 项目文档

- [AGENTS.md](AGENTS.md) — 项目上下文与开发规范
- [DESIGN.md](DESIGN.md) — 设计规范
- [docs/Mac-mini-M4数据库安装步骤.md](docs/Mac-mini-M4数据库安装步骤.md) — 自托管 Supabase 安装
- [docs/简历批处理与钉钉写回部署说明.md](docs/简历批处理与钉钉写回部署说明.md)
- [docs/Boss结构化简历与candidate-analysis报告方案.md](docs/Boss结构化简历与candidate-analysis报告方案.md)
- [docs/GOAI参赛说明_无界应用.md](docs/GOAI参赛说明_无界应用.md) — GOAI 无界应用赛道参赛说明（目标用户/闭环/架构/合规）
- [docs/数据合规与隐私白皮书.md](docs/数据合规与隐私白皮书.md) — 数据合规与隐私保护全文
- [docs/评测报告_2026-08.md](docs/评测报告_2026-08.md) — 真实数据评测：Spearman 0.706、强推召回率@10 4/4（可复现）
- [docs/evidence/README.md](docs/evidence/README.md) — 运行证据与质量门禁证据包

## 开源许可

本项目基于 [Apache License 2.0](LICENSE) 开源。
