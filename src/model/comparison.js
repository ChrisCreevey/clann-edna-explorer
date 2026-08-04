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
   * @param {{valueField?: 'cladeReads'|'pctOfTotal', secondaryValueField?: 'cladeReads'|'pctOfTotal', filters?: object}} [options]
   *   `secondaryValueField`, if given, returns a second matrix in the same
   *   taxa/sample order as `matrix` — e.g. the heatmap colours cells by raw
   *   `cladeReads` (so sequencing depth is visible at a glance) but wants
   *   `pctOfTotal` alongside for the hover tooltip, without a second,
   *   independently-sorted call.
   * @returns {{taxa: Array<{taxid:number,name:string,total:number}>, sampleIds: string[], matrix: number[][], secondaryMatrix?: number[][]}}
   */
  function buildAbundanceMatrix(tree, sampleIds, rank, options = {}) {
    const valueField = options.valueField || 'cladeReads';
    const perSampleRows = sampleIds.map((id) => computeRankTable(tree, id, rank, '', options.filters));

    const taxonMeta = new Map(); // taxid -> {taxid, name}
    perSampleRows.forEach((rows) => {
      rows.forEach((r) => {
        if (!taxonMeta.has(r.taxid)) taxonMeta.set(r.taxid, { taxid: r.taxid, name: r.name });
      });
    });

    const taxids = [...taxonMeta.keys()];
    const rowIndex = new Map(taxids.map((id, i) => [id, i]));
    const matrix = taxids.map(() => sampleIds.map(() => 0));
    const secondaryMatrix = options.secondaryValueField ? taxids.map(() => sampleIds.map(() => 0)) : null;

    perSampleRows.forEach((rows, colIdx) => {
      rows.forEach((r) => {
        const i = rowIndex.get(r.taxid);
        matrix[i][colIdx] = r[valueField] || 0;
        if (secondaryMatrix) secondaryMatrix[i][colIdx] = r[options.secondaryValueField] || 0;
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
      ...(secondaryMatrix ? { secondaryMatrix: order.map((i) => secondaryMatrix[i]) } : {}),
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
   * Per-sample composition series for a stacked bar chart: each sample
   * contributes *its own* top N taxa (by that sample's cladeReads) — not
   * the top N by combined total across samples — since a taxon that
   * dominates one sample but is minor everywhere else would otherwise be
   * folded into "Other" for the very sample it matters most in. The union
   * of every sample's top N becomes the shared taxon list every bar
   * stacks against (so a taxon another sample surfaced still gets its own
   * slice here, however small, rather than being folded into this
   * sample's "Other"); a per-sample "Other" bucket covers the remainder.
   * Mirrors the single-sample Top-N chart's approach (src/model/
   * rank-table.js computeTopN), applied per sample instead of globally.
   *
   * Each segment (and the "Other" bucket) carries both `value` (raw
   * cladeReads) and `pct` (that sample's % of total) — the chart picks
   * whichever drives bar height depending on its raw/% display mode, but
   * the tooltip always has both regardless of mode. `total` is the
   * sample's own grand total at this rank (post-filter), needed as the
   * per-column height in raw mode and as the shared-scale reference
   * across columns.
   *
   * @returns {{taxonNames: string[], series: Array<{sampleId: string, total: number, values: Array<{name: string, value: number, pct: number}>, otherValue: number, otherPct: number}>}}
   */
  function computeStackedComposition(tree, sampleIds, rank, maxTaxa = 10, filters = null) {
    const { taxa, matrix, sampleIds: cols } = buildAbundanceMatrix(tree, sampleIds, rank, { valueField: 'cladeReads', filters });

    // Each sample's own top N row-indices, by that column's value.
    const unionIndices = new Set();
    cols.forEach((_, colIdx) => {
      matrix
        .map((row, rowIdx) => ({ rowIdx, value: row[colIdx] }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, maxTaxa)
        .forEach((r) => unionIndices.add(r.rowIdx));
    });

    // `taxa`/`matrix` are already ordered by combined total descending
    // (see buildAbundanceMatrix) — keep that relative order for the
    // union subset so the legend/stack order stays stable and legible.
    const topIndices = taxa.map((_, i) => i).filter((i) => unionIndices.has(i));
    const topTaxa = topIndices.map((i) => taxa[i]);

    const columnTotals = cols.map((_, colIdx) => matrix.reduce((s, row) => s + row[colIdx], 0));

    const series = cols.map((sampleId, colIdx) => {
      const total = columnTotals[colIdx] || 1;
      const values = topIndices.map((rowIdx) => ({
        name: taxa[rowIdx].name,
        value: matrix[rowIdx][colIdx],
        pct: (100 * matrix[rowIdx][colIdx]) / total,
      }));
      const topValueSum = values.reduce((s, v) => s + v.value, 0);
      const topPctSum = values.reduce((s, v) => s + v.pct, 0);
      return {
        sampleId,
        total,
        values,
        otherValue: Math.max(0, total - topValueSum),
        otherPct: Math.max(0, 100 - topPctSum),
      };
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
