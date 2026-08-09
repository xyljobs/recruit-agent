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
 * 输出：逐候选人得分表、排序指标、强推召回、硬性条件误放和双标注一致性。
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
import {
  calculateQuadraticWeightedKappa,
  calculateRankingMetrics,
  calculateSpearman,
} from '@/lib/matching/evaluation';

interface BenchmarkAnnotation {
  annotator_id: string;
  human_rank: number;
}

interface BenchmarkCandidate {
  id: string;
  human_rank: number;
  hard_fail?: boolean;
  annotations?: BenchmarkAnnotation[];
  profile: MatchCandidateInput;
}

interface Benchmark {
  job: MatchJobInput;
  candidates: BenchmarkCandidate[];
}

function getCompleteAnnotationPair(
  candidates: readonly BenchmarkCandidate[],
): { first: number[]; second: number[]; annotators: [string, string] } | null {
  const annotatorIds = [...new Set(
    candidates.flatMap(candidate => candidate.annotations?.map(annotation => annotation.annotator_id) ?? []),
  )].sort();
  if (annotatorIds.length !== 2) return null;
  const [firstAnnotator, secondAnnotator] = annotatorIds;
  const first: number[] = [];
  const second: number[] = [];
  for (const candidate of candidates) {
    const firstRank = candidate.annotations?.find(
      annotation => annotation.annotator_id === firstAnnotator,
    )?.human_rank;
    const secondRank = candidate.annotations?.find(
      annotation => annotation.annotator_id === secondAnnotator,
    )?.human_rank;
    if (firstRank === undefined || secondRank === undefined) return null;
    first.push(firstRank);
    second.push(secondRank);
  }
  return { first, second, annotators: [firstAnnotator, secondAnnotator] };
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
      hardFail: candidate.hard_fail,
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
  const rho = calculateSpearman(humanRanks, systemRanks);

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
  console.log(`Top-${k} 命中（并列截断，仅兼容）: ${hits}/${k}`);

  const rankingMetrics = calculateRankingMetrics(systemOrder);
  console.log(`NDCG@10: ${rankingMetrics.ndcgAt10.toFixed(3)}`);
  console.log(`Precision@5: ${rankingMetrics.precisionAt5.toFixed(3)}`);

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

  console.log(`强推漏出数@10: ${rankingMetrics.strongMissIdsAt10.length}`);
  if (benchmark.candidates.some(candidate => candidate.hard_fail !== undefined)) {
    console.log(`硬性条件误放数@10: ${rankingMetrics.hardFailTop10Ids.length}`);
  } else {
    console.log('硬性条件误放数@10: 未评估（基准文件缺少 hard_fail）');
  }

  const annotationPair = getCompleteAnnotationPair(benchmark.candidates);
  if (annotationPair) {
    const kappa = calculateQuadraticWeightedKappa(annotationPair.first, annotationPair.second);
    console.log(
      `双标注加权 Cohen's kappa (${annotationPair.annotators.join(' / ')}): `
      + (kappa === null ? '无法计算' : kappa.toFixed(3)),
    );
  } else {
    console.log("双标注加权 Cohen's kappa: 未评估（需要两位标注者覆盖全部候选人）");
  }

  if (rho < 0.5) {
    console.warn('警告: 与人工基准排序一致性偏低，请检查评分权重或基准标注口径。');
  }
}

main();
