# 证据包（Evidence）

> GOAI 无界应用赛道"运行证据 / 评测结果 / 工程质量"三项要求的可验证材料索引。
> 全部材料可在本仓库内复现，无外部依赖。

## 目录

| 文件 | 内容 | 对应赛道要求 |
|------|------|--------------|
| [boss-search-状态机运行日志.md](boss-search-状态机运行日志.md) | Boss 搜索 Agent 任务队列 9 条真实任务的状态机流转（脱敏）：租约认领、异步等待、失败重试、报告回写 | 运行证据 / 异常处理 |
| [raw-validate.txt](raw-validate.txt) | `pnpm validate`（TypeScript strict 类型检查 + ESLint）原始输出，退出码 0 | 工程质量 |
| [raw-test-unit.txt](raw-test-unit.txt) | `pnpm run test:unit` 原始输出：**74 个单元测试全部通过**（node:test） | 工程质量 |
| [raw-test-db.txt](raw-test-db.txt) | `pnpm run test:db` 原始输出：数据库集成测试通过——迁移幂等、RLS、决策流程状态、事件重放、集成导入、Worker RPC、100 候选人性能包络（短名单提交 p95 ≈ 3.3ms） | 工程质量 / 可复制性 |
| [raw-test-python.txt](raw-test-python.txt) | Python Worker（Boss 搜索 / 简历批处理 / 报告渲染）unittest 原始输出 | 工程质量 |
| [run-summary.txt](run-summary.txt) | 上述各步骤退出码汇总（2026-08-04 采集） | — |

相关证据（位于本目录之外）：

- [../评测报告_2026-08.md](../评测报告_2026-08.md)：真实数据评测——20 份真实授权简历（去标识 R01-R20）+ 资深招聘方三档标注，Spearman 秩相关 **0.706**，强推召回率@10 **4/4**。复现：`pnpm eval:match scripts/match-benchmark.java-real.json`
- [../数据合规与隐私白皮书.md](../数据合规与隐私白皮书.md)：合规披露全文

## 待补充（依赖线下素材）

- 决策看板与短名单页脱敏截图 3 帧（随 Demo 视频录制产出后补入）

## 复现说明

```bash
pnpm install
pnpm validate
pnpm run test:unit
pnpm run test:db
cd assets && uv run --locked python -m unittest discover -s tests -v
```

GitHub Actions（`.github/workflows/ci.yml`）对每次推送自动执行上述门禁。
