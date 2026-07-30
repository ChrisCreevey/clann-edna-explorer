const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { parseBracken } = require('../src/parsers/bracken');
const { parseBreport } = require('../src/parsers/breport');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('bracken.js');

test('parses barcode39.bracken (455 rows, header skipped)', () => {
  const tree = new TaxonomyTree();
  const stats = parseBracken(read('barcode39.bracken'), tree, 'barcode39');
  assert.strictEqual(stats.rowCount, 454); // 455 lines minus header
  assert.strictEqual(stats.totalReads, 567327);
});

test('known species node (taxid 1790162) merges kraken/added/new_est correctly', () => {
  const tree = new TaxonomyTree();
  parseBracken(read('barcode39.bracken'), tree, 'barcode39');
  const counts = tree.getSampleCounts(1790162, 'barcode39');
  assert.strictEqual(counts.krakenAssignedReads, 31012);
  assert.strictEqual(counts.addedReads, 2752);
  assert.strictEqual(counts.cladeReads, 33764);
});

test('bracken-only sample creates leaf nodes with no ancestor chain', () => {
  const tree = new TaxonomyTree();
  parseBracken(read('barcode39.bracken'), tree, 'barcode39');
  const node = tree.node(1790162);
  assert.strictEqual(node.parentTaxid, null);
});

test('PLAN.md §1 finding: .breport species-rank cladeReads reconciles exactly with .bracken new_est_reads', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBracken(read('barcode39.bracken'), tree, 'barcode39'); // merges onto existing nodes

  const counts = tree.getSampleCounts(1790162, 'barcode39');
  // breport's cladeReads (33764) must survive the bracken merge unchanged,
  // and equal new_est_reads exactly, per the empirical finding in PLAN.md.
  assert.strictEqual(counts.cladeReads, 33764);
  assert.strictEqual(counts.krakenAssignedReads, 31012);
  assert.strictEqual(counts.addedReads, 2752);
});

test('PLAN.md §1 finding: sum of breport S-rank cladeReads equals sum of bracken new_est_reads', () => {
  const treeBreportOnly = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), treeBreportOnly, 'barcode39');
  let sRankSum = 0;
  for (let i = 0; i < treeBreportOnly.size; i++) {
    if (treeBreportOnly.rankLetter[i] === 'S' && treeBreportOnly.rankSub[i] === 0) {
      sRankSum += treeBreportOnly.perSample[i].get('barcode39').cladeReads;
    }
  }

  const treeBrackenOnly = new TaxonomyTree();
  const brackenStats = parseBracken(read('barcode39.bracken'), treeBrackenOnly, 'barcode39');

  assert.strictEqual(sRankSum, 567327);
  assert.strictEqual(brackenStats.totalReads, 567327);
  assert.strictEqual(sRankSum, brackenStats.totalReads);
});

report();
