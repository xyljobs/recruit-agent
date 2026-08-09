export interface RankedEvaluationItem {
  id: string;
  humanRank: number;
  hardFail?: boolean;
}

export interface RankingMetrics {
  ndcgAt10: number;
  precisionAt5: number;
  strongRecallAt5: number | null;
  strongRecallAt10: number | null;
  strongMissIdsAt10: string[];
  hardFailTop10Ids: string[];
}

export function averageRanks(values: readonly number[]): number[] {
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

export function calculateSpearman(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length < 2) return 0;
  const rankA = averageRanks(a);
  const rankB = averageRanks(b);
  const meanA = rankA.reduce((sum, value) => sum + value, 0) / rankA.length;
  const meanB = rankB.reduce((sum, value) => sum + value, 0) / rankB.length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < rankA.length; i += 1) {
    const deltaA = rankA[i] - meanA;
    const deltaB = rankB[i] - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
  }
  if (varianceA === 0 || varianceB === 0) return 0;
  return covariance / Math.sqrt(varianceA * varianceB);
}

function relevance(humanRank: number): number {
  return Math.max(0, 3 - humanRank);
}

function discountedCumulativeGain(relevances: readonly number[]): number {
  return relevances.reduce((sum, value, index) => {
    const gain = (2 ** value) - 1;
    return sum + gain / Math.log2(index + 2);
  }, 0);
}

export function calculateNdcgAtK(
  systemOrder: readonly RankedEvaluationItem[],
  k: number,
): number {
  const limit = Math.min(k, systemOrder.length);
  if (limit === 0) return 0;
  const actual = systemOrder.slice(0, limit).map(item => relevance(item.humanRank));
  const ideal = systemOrder
    .map(item => relevance(item.humanRank))
    .sort((a, b) => b - a)
    .slice(0, limit);
  const idealScore = discountedCumulativeGain(ideal);
  return idealScore === 0 ? 0 : discountedCumulativeGain(actual) / idealScore;
}

export function calculatePrecisionAtK(
  systemOrder: readonly RankedEvaluationItem[],
  k: number,
): number {
  const limit = Math.min(k, systemOrder.length);
  if (limit === 0) return 0;
  const hits = systemOrder.slice(0, limit).filter(item => item.humanRank === 1).length;
  return hits / limit;
}

export function calculateRecallAtK(
  systemOrder: readonly RankedEvaluationItem[],
  k: number,
): number | null {
  const strongIds = new Set(systemOrder.filter(item => item.humanRank === 1).map(item => item.id));
  if (strongIds.size === 0) return null;
  const hits = systemOrder
    .slice(0, Math.min(k, systemOrder.length))
    .filter(item => strongIds.has(item.id)).length;
  return hits / strongIds.size;
}

export function calculateQuadraticWeightedKappa(
  first: readonly number[],
  second: readonly number[],
  categories: readonly number[] = [1, 2, 3],
): number | null {
  if (first.length !== second.length || first.length === 0 || categories.length < 2) return null;
  const indexByCategory = new Map(categories.map((category, index) => [category, index]));
  if ([...first, ...second].some(value => !indexByCategory.has(value))) return null;

  const firstCounts = new Array<number>(categories.length).fill(0);
  const secondCounts = new Array<number>(categories.length).fill(0);
  let observedDisagreement = 0;
  const denominator = (categories.length - 1) ** 2;

  for (let i = 0; i < first.length; i += 1) {
    const firstIndex = indexByCategory.get(first[i]);
    const secondIndex = indexByCategory.get(second[i]);
    if (firstIndex === undefined || secondIndex === undefined) return null;
    firstCounts[firstIndex] += 1;
    secondCounts[secondIndex] += 1;
    observedDisagreement += ((firstIndex - secondIndex) ** 2) / denominator;
  }
  observedDisagreement /= first.length;

  let expectedDisagreement = 0;
  for (let i = 0; i < categories.length; i += 1) {
    for (let j = 0; j < categories.length; j += 1) {
      const expectedProbability = (firstCounts[i] / first.length) * (secondCounts[j] / second.length);
      expectedDisagreement += expectedProbability * (((i - j) ** 2) / denominator);
    }
  }
  if (expectedDisagreement === 0) return observedDisagreement === 0 ? 1 : null;
  return 1 - (observedDisagreement / expectedDisagreement);
}

export function calculateRankingMetrics(
  systemOrder: readonly RankedEvaluationItem[],
): RankingMetrics {
  const top10 = systemOrder.slice(0, Math.min(10, systemOrder.length));
  const top10Ids = new Set(top10.map(item => item.id));
  return {
    ndcgAt10: calculateNdcgAtK(systemOrder, 10),
    precisionAt5: calculatePrecisionAtK(systemOrder, 5),
    strongRecallAt5: calculateRecallAtK(systemOrder, 5),
    strongRecallAt10: calculateRecallAtK(systemOrder, 10),
    strongMissIdsAt10: systemOrder
      .filter(item => item.humanRank === 1 && !top10Ids.has(item.id))
      .map(item => item.id),
    hardFailTop10Ids: top10.filter(item => item.hardFail === true).map(item => item.id),
  };
}
