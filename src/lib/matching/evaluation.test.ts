import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateNdcgAtK,
  calculatePrecisionAtK,
  calculateQuadraticWeightedKappa,
  calculateRankingMetrics,
  calculateSpearman,
  type RankedEvaluationItem,
} from './evaluation';

const perfect: RankedEvaluationItem[] = [
  { id: 'a', humanRank: 1 },
  { id: 'b', humanRank: 1 },
  { id: 'c', humanRank: 2 },
  { id: 'd', humanRank: 3 },
];

describe('matching evaluation metrics', () => {
  it('calculates perfect rank metrics', () => {
    assert.equal(calculateSpearman([1, 2, 3], [1, 2, 3]), 1);
    assert.equal(calculateNdcgAtK(perfect, 4), 1);
    assert.equal(calculatePrecisionAtK(perfect, 2), 1);
  });

  it('calculates quadratic weighted kappa and rejects incomplete pairs', () => {
    assert.equal(calculateQuadraticWeightedKappa([1, 2, 3], [1, 2, 3]), 1);
    assert.equal(calculateQuadraticWeightedKappa([1, 2], [1]), null);
    assert.equal(calculateQuadraticWeightedKappa([], []), null);
  });

  it('reports strong misses and hard-condition false placements', () => {
    const rows: RankedEvaluationItem[] = Array.from({ length: 12 }, (_, index) => ({
      id: `c${index + 1}`,
      humanRank: index === 11 ? 1 : 3,
      hardFail: index === 0,
    }));
    const metrics = calculateRankingMetrics(rows);
    assert.deepEqual(metrics.strongMissIdsAt10, ['c12']);
    assert.deepEqual(metrics.hardFailTop10Ids, ['c1']);
    assert.equal(metrics.strongRecallAt10, 0);
  });
});
