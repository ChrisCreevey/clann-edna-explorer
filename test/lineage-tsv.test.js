const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { sniffFormat } = require('../src/parsers/sniff');
const { parseLineageTsv, syntheticTaxid } = require('../src/parsers/lineage-tsv');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { computeSampleSummary } = require('../src/model/summary');
const { buildAbundanceMatrix } = require('../src/model/comparison');
const { buildSample } = require('../src/model/sample');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('lineage-tsv.js');

test('sniffFormat identifies a Lineage TSV file as high confidence', () => {
  const result = sniffFormat(read('lineage-example.tsv'));
  assert.strictEqual(result.format, 'lineage-tsv');
  assert.strictEqual(result.confidence, 'high');
});

test('sniffFormat rejects .breport/.bracken/generic files as lineage-tsv', () => {
  assert.strictEqual(sniffFormat(read('barcode39.breport')).format, 'breport');
  assert.strictEqual(sniffFormat(read('barcode39.bracken')).format, 'bracken');
  const genericText = [
    'taxon\tcount\textra',
    'Escherichia coli\t120\tfoo',
    'Bacillus subtilis\t45\tbar',
    'Pseudomonas putida\t9\tbaz',
  ].join('\n');
  assert.strictEqual(sniffFormat(genericText).format, 'generic');
});

test('parses the fixture into a connected tree with expected structure', () => {
  const tree = new TaxonomyTree();
  const stats = parseLineageTsv(read('lineage-example.tsv'), tree, 's1');
  // 7 data rows total, 5 classified + 1 gapped + 1 unclassified all counted as rows
  assert.strictEqual(stats.rowCount, 7);
  assert.ok(tree.size > 0);

  const root = tree.node(1);
  assert.ok(root);
  assert.strictEqual(root.depth, 0);
});

test('genus node cladeReads equals sum of its species children cladeReads', () => {
  const tree = new TaxonomyTree();
  parseLineageTsv(read('lineage-example.tsv'), tree, 's1');
  const musIdx = tree.taxidToIndex.get(10088); // Mus genus
  assert.ok(musIdx !== undefined);
  const musCounts = tree.getSampleCounts(10088, 's1');
  const speciesCounts = tree.getSampleCounts(10090, 's1'); // Mus musculus
  assert.strictEqual(musCounts.cladeReads, speciesCounts.cladeReads);
  assert.strictEqual(speciesCounts.cladeReads, 27); // 17 + 10 accumulated
});

test('root cladeReads equals total classified reads (42+17+10+3+7+8 = 87)', () => {
  const tree = new TaxonomyTree();
  const stats = parseLineageTsv(read('lineage-example.tsv'), tree, 's1');
  const root = tree.getSampleCounts(1, 's1');
  assert.strictEqual(root.cladeReads, 87);
  assert.strictEqual(stats.totalReads, 92); // + 5 unclassified
});

test('two rows resolving to the same species sum directReads/cladeReads', () => {
  const tree = new TaxonomyTree();
  parseLineageTsv(read('lineage-example.tsv'), tree, 's1');
  const counts = tree.getSampleCounts(10090, 's1');
  assert.strictEqual(counts.directReads, 27);
  assert.strictEqual(counts.cladeReads, 27);
});

test('gapped lineage attaches species directly under the nearest present ancestor', () => {
  const tree = new TaxonomyTree();
  parseLineageTsv(read('lineage-example.tsv'), tree, 's1');
  const bufoTaxid = syntheticTaxid(['eukaryota', 'bufo bufo'].join('|'));
  const node = tree.node(bufoTaxid);
  assert.ok(node, 'expected a synthetic node for Bufo bufo');
  assert.strictEqual(node.parentTaxid, 2759); // superkingdom Eukaryota, real NCBI taxid
  assert.strictEqual(node.depth, 2);
});

test('synthetic taxid hash is stable across separate parses and differs for different paths', () => {
  const treeA = new TaxonomyTree();
  parseLineageTsv(read('lineage-example.tsv'), treeA, 'sampleA');
  const treeB = new TaxonomyTree();
  parseLineageTsv(read('lineage-example.tsv'), treeB, 'sampleB');

  const bufoTaxid = syntheticTaxid(['eukaryota', 'bufo bufo'].join('|'));
  assert.ok(treeA.taxidToIndex.has(bufoTaxid));
  assert.ok(treeB.taxidToIndex.has(bufoTaxid));

  const differentPath = syntheticTaxid(['bacteria', 'other bug'].join('|'));
  assert.notStrictEqual(bufoTaxid, differentPath);
});

test('unclassified reads accumulate onto a single U node at depth 0', () => {
  const tree = new TaxonomyTree();
  parseLineageTsv(read('lineage-example.tsv'), tree, 's1');
  const unclassified = tree.node(0);
  assert.ok(unclassified);
  assert.strictEqual(unclassified.depth, 0);
  const counts = tree.getSampleCounts(0, 's1');
  assert.strictEqual(counts.cladeReads, 5);
});

test('computeSampleSummary reports correct classified/unclassified split for a Lineage TSV sample', () => {
  const tree = new TaxonomyTree();
  parseLineageTsv(read('lineage-example.tsv'), tree, 's1');
  const summary = computeSampleSummary(tree, 's1');
  assert.strictEqual(summary.classifiedReads, 87);
  assert.strictEqual(summary.unclassifiedReads, 5);
  assert.strictEqual(summary.totalReads, 92);
});

test('sample.kind is "tree" for a Lineage-TSV-only sample, not "generic"', () => {
  const tree = new TaxonomyTree();
  const parsers = {
    parseBreport: () => {},
    parseBracken: () => {},
    parseGeneric: () => ({ rows: [] }),
    parseLineageTsv,
    captureProvenance: () => null,
  };
  const sample = buildSample(
    's1',
    { lineageTsv: { text: read('lineage-example.tsv'), filename: 'lineage-example.tsv' } },
    tree,
    parsers
  );
  assert.strictEqual(sample.kind, 'tree');
  assert.strictEqual(sample.hasLineageTsv, true);
});

test('a Lineage-TSV sample is included in multi-sample comparison output (not filtered as generic)', () => {
  const tree = new TaxonomyTree();
  const parsers = {
    parseBreport: () => {},
    parseBracken: () => {},
    parseGeneric: () => ({ rows: [] }),
    parseLineageTsv,
    captureProvenance: () => null,
  };
  const sample = buildSample(
    's1',
    { lineageTsv: { text: read('lineage-example.tsv'), filename: 'lineage-example.tsv' } },
    tree,
    parsers
  );
  assert.notStrictEqual(sample.kind, 'generic');
  const matrix = buildAbundanceMatrix(tree, [sample.id], 'S', {});
  assert.ok(matrix.taxa.length > 0, 'expected species-level rows for the lineage-tsv sample');
});

report();
