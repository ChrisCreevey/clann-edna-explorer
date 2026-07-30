// Plain CSV/TSV exports (brief: "Export the filtered taxon table... as
// CSV/TSV, current group assignments included as a column so the export
// is self-describing without the tool" and "Export diversity and
// similarity summary tables as CSV, per-sample and per-group"). Unlike
// the MicrobiomeAnalyst export, these aren't built to any external tool's
// spec — just a straightforward, human-readable CSV of whatever the
// current view is showing, quoted per RFC 4180 so names with commas
// don't corrupt the column structure.

(function () {
  'use strict';

  function csvEscape(value) {
    const s = String(value === undefined || value === null ? '' : value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(rows) {
    return rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
  }

  /**
   * Single-sample rank table -> CSV, one row per taxon, with the sample's
   * own group as a trailing column (self-describing per the brief, even
   * though every row repeats the same value for a single-sample export).
   */
  function rankTableToCsv(rows, sampleId, group) {
    const header = ['Sample', 'Group', 'Taxon', 'Taxid', 'Reads', 'PercentOfTotal'];
    const body = rows.map((r) => [sampleId, group || '', r.name, r.taxid ?? '', r.cladeReads, r.pctOfTotal.toFixed(6)]);
    return toCsv([header, ...body]);
  }

  /**
   * Multi-sample abundance matrix -> CSV, taxa as rows and samples as
   * columns (matching the on-screen heatmap's shape), with a "Group" row
   * directly under the sample-name header row so the export is
   * self-describing without needing this tool to interpret it.
   *
   * @param {{taxa: Array<{taxid:number,name:string}>, sampleIds: string[], matrix: number[][]}} abundanceMatrix
   * @param {Record<string,string>} groupBySampleId
   */
  function abundanceMatrixToCsv(abundanceMatrix, groupBySampleId) {
    const header = ['Taxon', 'Taxid', ...abundanceMatrix.sampleIds];
    const groupRow = ['Group', '', ...abundanceMatrix.sampleIds.map((id) => groupBySampleId[id] || '')];
    const body = abundanceMatrix.taxa.map((t, i) => [t.name, t.taxid, ...abundanceMatrix.matrix[i]]);
    return toCsv([header, groupRow, ...body]);
  }

  /**
   * Diversity summary (src/model/diversity.js computeDiversitySummary
   * output) -> CSV: one row per sample, then one row per group aggregate.
   */
  function diversitySummaryToCsv(diversitySummary) {
    const header = ['Sample', 'Group', 'Richness', 'Shannon', 'Simpson'];
    const sampleRows = diversitySummary.perSample.map((s) => [s.id, s.group, s.richness, s.shannon.toFixed(6), s.simpson.toFixed(6)]);
    const groupRows = [...diversitySummary.groupAggregates.entries()].map(([group, agg]) => [
      `${group} (mean)`,
      group,
      agg.richness.mean.toFixed(3),
      agg.shannon.mean.toFixed(6),
      agg.simpson.mean.toFixed(6),
    ]);
    return toCsv([header, ...sampleRows, ...groupRows]);
  }

  /**
   * Sample-similarity distance matrix -> CSV, a square sample x sample
   * grid matching the on-screen heatmap.
   */
  function distanceMatrixToCsv(distance) {
    const header = ['', ...distance.sampleIds];
    const body = distance.sampleIds.map((id, i) => [id, ...distance.matrix[i].map((v) => v.toFixed(6))]);
    return toCsv([header, ...body]);
  }

  const csvExportExports = { toCsv, csvEscape, rankTableToCsv, abundanceMatrixToCsv, diversitySummaryToCsv, distanceMatrixToCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = csvExportExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.csvExport = csvExportExports;
  }
})();
