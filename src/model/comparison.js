// Cross-sample data shaping for the multi-sample comparison views: a
// taxa x samples abundance matrix (shared by the heatmap and the
// similarity matrix), a presence/absence derivation of it, and a
// Top-N-across-all-samples composition breakdown for the stacked bar
// chart. All pure and DOM-free — rendering lives in src/viz/.

(function () {
  'use strict';

  const { computeRankTable } = typeof module !== 'undefined' && module.exports
    ? require('./rank-table')
    : window.ClannEDNA.rankTable;

  /**
   * Union of taxa at `rank` across all `sampleIds`, as a dense matrix
   * (missing taxon in a sample = 0). Rows ordered by total abundance
   * across the included samples, descending, so the most abundant taxa
   * are always at the top regardless of column order.
   *
   * @param {import('./taxonomy-tree').TaxonomyTree} tree
   * @param {string[]} sampleIds
   * @param {string} rank
   * @param {{valueField?: 'cladeReads'|'pctOfTotal'}} [options]
   * @returns {{taxa: Array<{taxid:number,name:string,total:number}>, sampleIds: string[], matrix: number[][]}}
   */
  function buildAbundanceMatrix(tree, sampleIds, rank, options = {}) {
    const valueField = options.valueField || 'cladeReads';
    const perSampleRows = sampleIds.map((id) => computeRankTable(tree, id, rank));

    const taxonMeta = new Map(); // taxid -> {taxid, name}
    perSampleRows.forEach((rows) => {
      rows.forEach((r) => {
        if (!taxonMeta.has(r.taxid)) taxonMeta.set(r.taxid, { taxid: r.taxid, name: r.name });
      });
    });

    const taxids = [...taxonMeta.keys()];
    const rowIndex = new Map(taxids.map((id, i) => [id, i]));
    const matrix = taxids.map(() => sampleIds.map(() => 0));

    perSampleRows.forEach((rows, colIdx) => {
      rows.forEach((r) => {
        matrix[rowIndex.get(r.taxid)][colIdx] = r[valueField] || 0;
      });
    });

    const taxa = taxids.map((taxid, i) => ({
      ...taxonMeta.get(taxid),
      total: matrix[i].reduce((s, v) => s + v, 0),
    }));

    // Sort rows (and matrix rows in lockstep) by total descending.
    const order = taxa.map((_, i) => i).sort((a, b) => taxa[b].total - taxa[a].total);
    return {
      taxa: order.map((i) => taxa[i]),
      sampleIds,
      matrix: order.map((i) => matrix[i]),
    };
  }

  /**
   * Presence/absence derivation of an abundance matrix: 1 where the
   * sample's value at that taxon meets `minAbundance` (read count, using
   * whatever field the matrix was built with), 0 otherwise.
   */
  function toPresenceAbsence(abundanceMatrix, minAbundance = 1) {
    return {
      taxa: abundanceMatrix.taxa,
      sampleIds: abundanceMatrix.sampleIds,
      matrix: abundanceMatrix.matrix.map((row) => row.map((v) => (v >= minAbundance ? 1 : 0))),
    };
  }

  /**
   * Per-sample composition series for a stacked bar chart: the top N taxa
   * *by total abundance across all included samples* (so every bar uses
   * the same taxon-to-colour mapping), plus a per-sample "Other" bucket
   * for the remainder — mirrors the single-sample Top-N chart's approach
   * (src/model/rank-table.js computeTopN), applied across samples instead
   * of within one.
   *
   * @returns {{taxonNames: string[], series: Array<{sampleId: string, values: Array<{name: string, pct: number}>, otherPct: number}>}}
   */
  function computeStackedComposition(tree, sampleIds, rank, maxTaxa = 10) {
    const { taxa, matrix, sampleIds: cols } = buildAbundanceMatrix(tree, sampleIds, rank, { valueField: 'cladeReads' });
    const topTaxa = taxa.slice(0, maxTaxa);
    const topIndices = topTaxa.map((_, i) => i);

    const columnTotals = cols.map((_, colIdx) => matrix.reduce((s, row) => s + row[colIdx], 0));

    const series = cols.map((sampleId, colIdx) => {
      const total = columnTotals[colIdx] || 1;
      const values = topIndices.map((rowIdx) => ({
        name: topTaxa[rowIdx].name,
        pct: (100 * matrix[rowIdx][colIdx]) / total,
      }));
      const topSum = values.reduce((s, v) => s + v.pct, 0);
      return { sampleId, values, otherPct: Math.max(0, 100 - topSum) };
    });

    return { taxonNames: topTaxa.map((t) => t.name), series };
  }

  const comparisonExports = { buildAbundanceMatrix, toPresenceAbsence, computeStackedComposition };
  if (typeof module !== 'undefined' && module.exports) module.exports = comparisonExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.comparison = comparisonExports;
  }
})();
