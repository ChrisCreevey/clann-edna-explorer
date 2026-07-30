(function () {
  'use strict';

// Read-summary statistics for a single tree-backed sample: total reads,
// classified vs unclassified, and (when a .bracken file was also loaded)
// raw Kraken-assigned vs Bracken-re-estimated counts at the leaf rank.

const { computeTreePruneMask } = typeof module !== 'undefined' && module.exports
  ? require('./filters')
  : window.ClannEDNA.filters;

/**
 * Sum of cladeReads for the topmost node in each excluded lineage (the
 * global host/contaminant exclusion list only — the abundance threshold is
 * a display-only filter elsewhere and doesn't belong in a read-count
 * summary). Only the topmost excluded ancestor in each lineage is summed,
 * since its cladeReads already includes every excluded descendant.
 */
function computeExcludedClassifiedReads(tree, sampleId, filters) {
  if (!filters || !filters.exclusionTerms || filters.exclusionTerms.length === 0) return 0;
  const pruned = computeTreePruneMask(tree, sampleId, { exclusionTerms: filters.exclusionTerms });
  let excluded = 0;
  for (let i = 0; i < tree.size; i++) {
    if (!pruned[i]) continue;
    const parentIdx = tree.parentIndex[i];
    const parentAlsoPruned = parentIdx !== -1 && pruned[parentIdx];
    if (parentAlsoPruned) continue; // already counted via the ancestor
    const counts = tree.perSample[i].get(sampleId);
    if (counts) excluded += counts.cladeReads || 0;
  }
  return excluded;
}

/**
 * @param {import('./taxonomy-tree').TaxonomyTree} tree
 * @param {string} sampleId
 * @param {{leafRank?: string, filters?: {exclusionTerms?: string[]}}} [options]
 */
function computeSampleSummary(tree, sampleId, options = {}) {
  const leafRank = options.leafRank || 'S';

  let classifiedReads = 0;
  let unclassifiedReads = 0;
  let rawAssignedReads = 0;
  let addedReads = 0;
  let reEstimatedReads = 0;
  let hasKrakenBreakdown = false;

  for (let i = 0; i < tree.size; i++) {
    const counts = tree.perSample[i].get(sampleId);
    if (!counts) continue;

    if (tree.depth[i] === 0) {
      if (tree.rankLetter[i] === 'U') unclassifiedReads += counts.cladeReads || 0;
      else classifiedReads += counts.cladeReads || 0;
    }

    if (tree.rankLetter[i] === leafRank && tree.rankSub[i] === 0 && counts.krakenAssignedReads !== undefined) {
      hasKrakenBreakdown = true;
      rawAssignedReads += counts.krakenAssignedReads;
      addedReads += counts.addedReads || 0;
      reEstimatedReads += counts.cladeReads || 0;
    }
  }

  const excludedReads = computeExcludedClassifiedReads(tree, sampleId, options.filters);
  classifiedReads = Math.max(0, classifiedReads - excludedReads);

  return {
    totalReads: classifiedReads + unclassifiedReads,
    classifiedReads,
    unclassifiedReads,
    classifiedPct: classifiedReads + unclassifiedReads > 0 ? (100 * classifiedReads) / (classifiedReads + unclassifiedReads) : 0,
    excludedReads,
    hasKrakenBreakdown,
    rawAssignedReads,
    addedReads,
    reEstimatedReads,
    leafRank,
  };
}

const summaryExports = { computeSampleSummary };
if (typeof module !== 'undefined' && module.exports) module.exports = summaryExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.summary = summaryExports;
}
})();
