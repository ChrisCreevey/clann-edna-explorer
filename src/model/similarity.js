// Sample-similarity distance matrix: Bray-Curtis (abundance-weighted) or
// Jaccard (presence/absence), both computed from the same abundance
// matrix comparison.js already builds. Full ordination (NMDS/PCA) is out
// of v1 scope per PLAN.md's open points — a distance-matrix heatmap is the
// v1 deliverable, not a dimensionality-reduced plot.

(function () {
  'use strict';

  const { buildAbundanceMatrix } = typeof module !== 'undefined' && module.exports
    ? require('./comparison')
    : window.ClannEDNA.comparison;

  function brayCurtisDistance(a, b) {
    let sumAbsDiff = 0;
    let sumTotal = 0;
    for (let i = 0; i < a.length; i++) {
      sumAbsDiff += Math.abs(a[i] - b[i]);
      sumTotal += a[i] + b[i];
    }
    return sumTotal === 0 ? 0 : sumAbsDiff / sumTotal;
  }

  function jaccardDistance(a, b, minAbundance) {
    let intersection = 0;
    let union = 0;
    for (let i = 0; i < a.length; i++) {
      const inA = a[i] >= minAbundance;
      const inB = b[i] >= minAbundance;
      if (inA || inB) union++;
      if (inA && inB) intersection++;
    }
    return union === 0 ? 0 : 1 - intersection / union;
  }

  /**
   * @param {import('./taxonomy-tree').TaxonomyTree} tree
   * @param {string[]} sampleIds
   * @param {string} rank
   * @param {'bray-curtis'|'jaccard'} metric
   * @param {{minAbundance?: number, filters?: object}} [options] - minAbundance is the presence threshold, jaccard only
   * @returns {{sampleIds: string[], matrix: number[][]}} symmetric distance matrix, 0 diagonal
   */
  function computeDistanceMatrix(tree, sampleIds, rank, metric, options = {}) {
    const minAbundance = options.minAbundance ?? 1;
    const { matrix: abundance, sampleIds: cols } = buildAbundanceMatrix(tree, sampleIds, rank, { filters: options.filters });

    const columns = cols.map((_, colIdx) => abundance.map((row) => row[colIdx]));
    const n = columns.length;
    const distance = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d =
          metric === 'jaccard'
            ? jaccardDistance(columns[i], columns[j], minAbundance)
            : brayCurtisDistance(columns[i], columns[j]);
        distance[i][j] = d;
        distance[j][i] = d;
      }
    }

    return { sampleIds: cols, matrix: distance };
  }

  const similarityExports = { brayCurtisDistance, jaccardDistance, computeDistanceMatrix };
  if (typeof module !== 'undefined' && module.exports) module.exports = similarityExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.similarity = similarityExports;
  }
})();
