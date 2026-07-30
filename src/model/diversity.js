// Alpha-diversity statistics for a single tree-backed sample at a given
// rank: observed richness, Shannon index, and Simpson's Index of Diversity
// (Gini-Simpson, 1 - sum(p_i^2)) — the three metrics the brief lists for
// both the overview dashboard's diversity plot and the per-sample/
// per-group diversity summary table.

(function () {
  'use strict';

  const { computeRankTable } = typeof module !== 'undefined' && module.exports
    ? require('./rank-table')
    : window.ClannEDNA.rankTable;

  /**
   * @param {import('./taxonomy-tree').TaxonomyTree} tree
   * @param {string} sampleId
   * @param {string} rank - canonical rank letter, e.g. 'S'
   * @returns {{richness: number, shannon: number, simpson: number, totalReads: number}}
   */
  function computeDiversity(tree, sampleId, rank) {
    const rows = computeRankTable(tree, sampleId, rank).filter((r) => r.cladeReads > 0);
    const totalReads = rows.reduce((s, r) => s + r.cladeReads, 0);

    if (totalReads === 0 || rows.length === 0) {
      return { richness: 0, shannon: 0, simpson: 0, totalReads: 0 };
    }

    let shannon = 0;
    let sumPSquared = 0;
    for (const row of rows) {
      const p = row.cladeReads / totalReads;
      shannon -= p * Math.log(p);
      sumPSquared += p * p;
    }

    return {
      richness: rows.length,
      shannon,
      simpson: 1 - sumPSquared,
      totalReads,
    };
  }

  /**
   * Diversity for every sample in `sampleIds`, plus a group-level
   * aggregate (mean and [min, max] range per metric) keyed by the group
   * each sample belongs to.
   *
   * @param {import('./taxonomy-tree').TaxonomyTree} tree
   * @param {Array<{id: string, group: string}>} samplesWithGroup
   * @param {string} rank
   */
  function computeDiversitySummary(tree, samplesWithGroup, rank) {
    const perSample = samplesWithGroup.map(({ id, group }) => ({
      id,
      group,
      ...computeDiversity(tree, id, rank),
    }));

    const byGroup = new Map();
    perSample.forEach((s) => {
      if (!byGroup.has(s.group)) byGroup.set(s.group, []);
      byGroup.get(s.group).push(s);
    });

    const groupAggregates = new Map();
    for (const [group, members] of byGroup) {
      const aggregate = {};
      ['richness', 'shannon', 'simpson'].forEach((metric) => {
        const values = members.map((m) => m[metric]);
        aggregate[metric] = {
          mean: values.reduce((s, v) => s + v, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
        };
      });
      groupAggregates.set(group, aggregate);
    }

    return { perSample, groupAggregates };
  }

  const diversityExports = { computeDiversity, computeDiversitySummary };
  if (typeof module !== 'undefined' && module.exports) module.exports = diversityExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.diversity = diversityExports;
  }
})();
