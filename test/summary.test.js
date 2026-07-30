const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { computeSampleSummary } = require('../src/model/summary');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');
const { parseBracken } = require('../src/parsers/bracken');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('summary.js');

test('barcode39: total/classified reads match root cladeReads (no unclassified row in this dataset)', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const summary = computeSampleSummary(tree, 'barcode39');
  assert.strictEqual(summary.totalReads, 567493);
  assert.strictEqual(summary.classifiedReads, 567493);
  assert.strictEqual(summary.unclassifiedReads, 0);
  assert.strictEqual(summary.classifiedPct, 100);
});

test('barcode39: raw vs re-estimated breakdown present once .bracken is merged in', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBracken(read('barcode39.bracken'), tree, 'barcode39');
  const summary = computeSampleSummary(tree, 'barcode39');
  assert.strictEqual(summary.hasKrakenBreakdown, true);
  assert.strictEqual(summary.reEstimatedReads, 567327);
  assert.strictEqual(summary.rawAssignedReads + summary.addedReads, summary.reEstimatedReads);
});

test('breport-only sample has no raw/re-estimated breakdown', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const summary = computeSampleSummary(tree, 'barcode39');
  assert.strictEqual(summary.hasKrakenBreakdown, false);
});

report();
