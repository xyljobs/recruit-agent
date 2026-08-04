/**
 * 匹配评分基准评测：对比系统基础分与人工基准排序的一致性。
 *
 * 用法：
 *   pnpm eval:match [benchmark.json]
 *   默认读取 scripts/match-benchmark.sample.json
 *
 * 输入格式：
 * {
 *   "job": { ...MatchJobInput },
 *   "candidates": [
 *     { "id": "c1", "human_rank": 1, "profile": { ...MatchCandidateInput } }
 *   ]
 * }
 *
 * 输出：逐候选人得分表 + Spearman 秩相关 + Top-K 命中率。
 * 该脚本只读本地 JSON，不访问数据库与模型，可在 CI 与离线环境运行。
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  calculateBaseMatchScore,
  SCORE_WEIGHTS,
  type MatchCandidateInput,
  type MatchJobInput,
} from '@/lib/matching/scorer';

interface BenchmarkCandidate {
  id: string;
  human_rank: number;
  profile: MatchCandidateInput;
}

interface Benchmark {
  job: MatchJobInput;
  candidates: BenchmarkCandidate[];
}

function averageRanks(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[sorted[k].index] = averageRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return 0;
  const rankA = averageRanks(a);
  const rankB = averageRanks(b);
  const n = rankA.length;
  const meanA = rankA.reduce((s, v) => s + v, 0) / n;
  const meanB = rankB.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = rankA[i] - meanA;
    const db = rankB[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

function main(): void {
  const benchmarkPath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(process.cwd(), 'scripts', 'match-benchmark.sample.json');

  let benchmark: Benchmark;
  try {
    benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8')) as Benchmark;
  } catch (error) {
    throw new Error(`无法读取基准文件 ${benchmarkPath}: ${String(error)}`);
  }

  if (!benchmark.job || !Array.isArray(benchmark.candidates) || benchmark.candidates.length < 2) {
    throw new Error('基准文件需包含 job 与至少 2 名 candidates');
  }

  const rows = benchmark.candidates.map(candidate => {
    const score = calculateBaseMatchScore(benchmark.job, candidate.profile, SCORE_WEIGHTS);
    return {
      id: candidate.id,
      humanRank: candidate.human_rank,
      overall: score.overall_score,
      skill: score.skill_score,
      experience: score.experience_score,
    };
  });

  // 系统排序：overall 越高排名越前（1 为最佳）
  const systemOrder = [...rows].sort((a, b) => b.overall - a.overall);
  const systemRankById = new Map(systemOrder.map((row, index) => [row.id, index + 1]));

  const humanRanks = rows.map(row => row.humanRank);
  const systemRanks = rows.map(row => systemRankById.get(row.id) ?? 0);
  const rho = spearman(humanRanks, systemRanks);

  const k = Math.min(3, rows.length);
  const humanTopK = new Set(
    [...rows].sort((a, b) => a.humanRank - b.humanRank).slice(0, k).map(row => row.id),
  );
  const systemTopK = systemOrder.slice(0, k).map(row => row.id);
  const hits = systemTopK.filter(id => humanTopK.has(id)).length;

  console.log('匹配评分基准评测');
  console.log(`基准文件: ${benchmarkPath}`);
  console.log('');
  console.log('id\t人工\t系统\toverall\tskill\texp');
  for (const row of [...rows].sort((a, b) => a.humanRank - b.humanRank)) {
    console.log(
      `${row.id}\t${row.humanRank}\t${systemRankById.get(row.id)}\t${row.overall}\t${row.skill}\t${row.experience}`,
    );
  }
  console.log('');
  console.log(`Spearman 秩相关: ${rho.toFixed(3)}`);
  console.log(`Top-${k} 命中率: ${hits}/${k}`);

  // 强推召回率：人工最高档（human_rank=1）在系统前 K 名中的覆盖比例，
  // 避免并列档位下 Top-K 截断造成的误导
  const topTier = rows.filter(row => row.humanRank === 1).map(row => row.id);
  if (topTier.length > 0) {
    const topTierSet = new Set(topTier);
    for (const recallK of [5, 10]) {
      const recallHits = systemOrder
        .slice(0, Math.min(recallK, systemOrder.length))
        .filter(row => topTierSet.has(row.id)).length;
      console.log(`强推召回率@${recallK}: ${recallHits}/${topTier.length}`);
    }
  }

  if (rho < 0.5) {
    console.warn('警告: 与人工基准排序一致性偏低，请检查评分权重或基准标注口径。');
  }
}

main();
