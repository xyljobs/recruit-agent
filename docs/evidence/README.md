# 证据包（Evidence）

> GOAI 无界应用赛道"运行证据 / 评测结果 / 工程质量"三项要求的可验证材料索引。
> 全部材料可在本仓库内复现，无外部依赖。

## 目录

| 文件 | 内容 | 对应赛道要求 |
|------|------|--------------|
| [boss-search-状态机运行日志.md](boss-search-状态机运行日志.md) | 历史实验性浏览器自动化状态机日志；仅作工程历史，不属于参赛功能或参赛效果证据 | 历史材料 / 参赛排除项 |
| [raw-validate.txt](raw-validate.txt) | `pnpm validate`（TypeScript strict 类型检查 + ESLint）原始输出，退出码 0 | 工程质量 |
| [raw-test-unit.txt](raw-test-unit.txt) | `pnpm run test:unit` 原始输出：**74 个单元测试全部通过**（node:test） | 工程质量 |
| [raw-test-db.txt](raw-test-db.txt) | `pnpm run test:db` 原始输出：数据库集成测试通过——迁移幂等、RLS、决策流程状态、事件重放、集成导入、Worker RPC、100 候选人性能包络（短名单提交 p95 ≈ 3.3ms） | 工程质量 / 可复制性 |
| [raw-test-python.txt](raw-test-python.txt) | Python Worker unittest 原始输出；其中浏览器自动化相关测试只证明代码行为，不代表合规或参赛能力 | 工程质量 |
| [run-summary.txt](run-summary.txt) | 上述各步骤退出码汇总（2026-08-04 采集） | — |
| [run-summary-2026-08-09.md](run-summary-2026-08-09.md) | 提交修复后的 fresh verification：79 个 TS 测试、25 个 Python 测试、数据库集成、生产构建、PPT/PDF 检查与本地 Docker 冒烟 | 当前提交证据 |
| [java-resume-source-audit-2026-08-09.md](java-resume-source-audit-2026-08-09.md) | 20 份授权 Java PDF 的本地完整性、匿名映射、结构化差异和新增排名指标核对；不包含身份信息 | IT 基线可追溯性 |

相关证据（位于本目录之外）：

- [../评测报告_2026-08.md](../评测报告_2026-08.md)：IT 单岗位基线——20 份真实授权去标识简历 + 单一资深招聘方三档标注，Spearman **0.706**、NDCG@10 **0.844**、Precision@5 **0.400**、强推召回率@10 **4/4**。不得外推为制造业效果。复现：`pnpm eval:match scripts/match-benchmark.java-real.json`
- [../制造业评测方案.md](../制造业评测方案.md)：三岗位、双标注、至少 60 份授权简历的预注册评测方案；当前尚未产出结果。
- [../数据合规与隐私白皮书.md](../数据合规与隐私白皮书.md)：合规披露全文

## 产品截图

- [2026-08-09 本地运行的参赛 Demo 指南](demo-guide-2026-08-09.png)
- [数据源与 AI 执行边界](../images/readme-data-sources.png)
- [职位与标准](../images/readme-jobs.png)
- [制造业候选人短名单](../images/readme-shortlists.png)

第一张截图来自 2026-08-09 当前 Docker 服务的公开指南页。其余三张来自 2026-08-05 的 Windows Docker 从零复现环境，使用虚构 seed 数据；它们不是 2026-08-09 的现场录屏，也不替代真实 Demo 视频。视频文件与有效托管链接仍需在录制、匿名访问复核和上传后补充。

## 复现说明

```bash
pnpm install
pnpm validate
pnpm run test:unit
pnpm run test:db
cd assets && uv run --locked python -m unittest discover -s tests -v
```

GitHub Actions（`.github/workflows/ci.yml`）对每次推送自动执行上述门禁。
