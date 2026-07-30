const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { computeAvailableRanks, computeRankTable, computeGenericTable, computeTopN } = require('../src/model/rank-table');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');
const { parseBracken } = require('../src/parsers/bracken');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('rank-table.js');

test('available ranks for barcode39 are in taxonomic order', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const ranks = computeAvailableRanks(tree, 'barcode39');
  assert.deepStrictEqual(ranks, ['D', 'K', 'P', 'C', 'O', 'F', 'G', 'S']);
});

test('species-rank table includes the known taxon with correct values', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const rows = computeRankTable(tree, 'barcode39', 'S');
  const row = rows.find((r) => r.taxid === 1790162);
  assert.ok(row);
  assert.strictEqual(row.name, 'Coccinella transversoguttata');
  assert.strictEqual(row.cladeReads, 33764);
});

test('search term filters by name, case-insensitively', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const rows = computeRankTable(tree, 'barcode39', 'S', 'coccinella');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.name.toLowerCase().includes('coccinella')));
});

test('search term also matches by taxid', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const rows = computeRankTable(tree, 'barcode39', 'S', '1790162');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].taxid, 1790162);
});

test('top-N buckets the remainder into a single "Other" row', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const rows = computeRankTable(tree, 'barcode39', 'S');
  const { top, other } = computeTopN(rows, 5);
  assert.strictEqual(top.length, 5);
  assert.ok(other.count > 0);
  const totalReadsAccounted = top.reduce((s, r) => s + r.cladeReads, 0) + other.cladeReads;
  const fullTotal = rows.reduce((s, r) => s + r.cladeReads, 0);
  assert.strictEqual(totalReadsAccounted, fullTotal);
});

test('top-N with N >= row count omits the "Other" bucket', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const rows = computeRankTable(tree, 'barcode39', 'S');
  const { top, other } = computeTopN(rows, rows.length + 10);
  assert.strictEqual(top.length, rows.length);
  assert.strictEqual(other, null);
});

test('generic table computes percentage of total from row sum', () => {
  const rows = [
    { name: 'Escherichia coli', abundance: 75 },
    { name: 'Bacillus subtilis', abundance: 25 },
  ];
  const table = computeGenericTable(rows);
  assert.strictEqual(table[0].pctOfTotal, 75);
  assert.strictEqual(table[1].pctOfTotal, 25);
});

test('bracken-only sample (leaf nodes at depth 0, no ancestor chain) still exposes species rank', () => {
  const tree = new TaxonomyTree();
  parseBracken(read('barcode39.bracken'), tree, 'barcode39');
  const ranks = computeAvailableRanks(tree, 'barcode39');
  assert.deepStrictEqual(ranks, ['S']);
  const rows = computeRankTable(tree, 'barcode39', 'S');
  assert.strictEqual(rows.length, 454);
});

report();
