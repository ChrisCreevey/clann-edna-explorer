// Dumps the eDNA Explorer's own computed numbers (not a re-implementation —
// the exact same src/model/*.js code the app runs in the browser) for the
// three barcode39/40/42 fixtures, as CSVs the R validation script can read.
// This is the "app side" of the report; validation/analysis.R independently
// recomputes the same tables from the raw .breport/.bracken files and the
// two get compared in validation/report.Rmd.
//
// Defaults mirror what the app UI defaults to for these fixtures (see
// src/app.js): comparison rank = last available rank ('S', species),
// similarity metric = Bray-Curtis, presence threshold = 1 read.

const fs = require('fs');
const path = require('path');

const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');
const { parseBracken } = require('../src/parsers/bracken');
const { computeRankTable, computeAvailableRanks } = require('../src/model/rank-table');
const { computeDiversitySummary } = require('../src/model/diversity');
const { computeDistanceMatrix } = require('../src/model/similarity');
const { computePCoA } = require('../src/model/ordination');
const { rankTableToCsv, diversitySummaryToCsv, distanceMatrixToCsv } = require('../src/model/csv-export');

const fixturesDir = path.join(__dirname, '..', 'test', 'fixtures');
const outDir = path.join(__dirname, 'app_exports', 'csv');
const read = (name) => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

const samples = ['barcode39', 'barcode40', 'barcode42'];

const tree = new TaxonomyTree();
samples.forEach((id) => {
  parseBreport(read(`${id}.breport`), tree, id);
  parseBracken(read(`${id}.bracken`), tree, id);
});

const ranks = computeAvailableRanks(tree, samples[0]);
const rank = ranks[ranks.length - 1]; // 'S' for these fixtures — matches the app's default
console.log(`Available ranks: ${ranks.join(', ')} — using rank "${rank}" (app default: last available rank)`);

// ---- Per-sample rank tables (species-rank abundance) ----------------------
samples.forEach((id) => {
  const rows = computeRankTable(tree, id, rank);
  fs.writeFileSync(path.join(outDir, `rank-table-${id}.csv`), rankTableToCsv(rows, id, ''));
});

// ---- Diversity summary -----------------------------------------------------
const samplesWithGroup = samples.map((id) => ({ id, group: 'Unassigned' }));
const diversitySummary = computeDiversitySummary(tree, samplesWithGroup, rank);
fs.writeFileSync(path.join(outDir, 'diversity-summary.csv'), diversitySummaryToCsv(diversitySummary));

// ---- Similarity: Bray-Curtis and Jaccard distance matrices ----------------
['bray-curtis', 'jaccard'].forEach((metric) => {
  const distance = computeDistanceMatrix(tree, samples, rank, metric, { minAbundance: 1 });
  fs.writeFileSync(path.join(outDir, `similarity-${metric}.csv`), distanceMatrixToCsv(distance));
});

// ---- PCoA ordination (on Bray-Curtis, matching the app's ordination panel) --
const { matrix: brayMatrix } = computeDistanceMatrix(tree, samples, rank, 'bray-curtis', { minAbundance: 1 });
const pcoa = computePCoA(brayMatrix, 2);
if (pcoa) {
  const header = ['Sample', 'PCo1', 'PCo2', 'VarExplained1_pct', 'VarExplained2_pct'];
  const body = samples.map((id, i) => [
    id,
    pcoa.points[i][0].toFixed(6),
    (pcoa.points[i][1] || 0).toFixed(6),
    pcoa.varianceExplained[0].toFixed(3),
    (pcoa.varianceExplained[1] || 0).toFixed(3),
  ]);
  const csv = [header, ...body].map((r) => r.join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'pcoa.csv'), csv);
} else {
  console.log('PCoA: not enough samples (need >= 3) — skipped');
}

// ---- Raw abundance matrix (for the R script to build its own equivalents) --
{
  const header = ['Taxon', 'Taxid', ...samples];
  const rowsBySampleTaxid = new Map(); // taxid -> {name, counts: {sampleId: cladeReads}}
  samples.forEach((id) => {
    computeRankTable(tree, id, rank).forEach((r) => {
      const key = r.taxid ?? r.name;
      if (!rowsBySampleTaxid.has(key)) rowsBySampleTaxid.set(key, { name: r.name, taxid: r.taxid, counts: {} });
      rowsBySampleTaxid.get(key).counts[id] = r.cladeReads;
    });
  });
  const body = [...rowsBySampleTaxid.values()].map((r) => [r.name, r.taxid ?? '', ...samples.map((id) => r.counts[id] || 0)]);
  const csv = [header, ...body].map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'raw-abundance-matrix.csv'), csv);
}

console.log(`Wrote app-side CSVs to ${outDir}`);
