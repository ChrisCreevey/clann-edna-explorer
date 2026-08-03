const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { sniffFormat } = require('../src/parsers/sniff');
const { parseQiimeTaxonomy, parseQiimeBiomTsv, buildQiimeSamples } = require('../src/parsers/qiime');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { computeSampleSummary } = require('../src/model/summary');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('qiime.js');

test('sniffFormat identifies a QIIME2 taxonomy.tsv as high confidence', () => {
  const result = sniffFormat(read('qiime-taxonomy.tsv'));
  assert.strictEqual(result.format, 'qiime-taxonomy');
  assert.strictEqual(result.confidence, 'high');
});

test('sniffFormat identifies a biom-tsv feature table as high confidence', () => {
  const result = sniffFormat(read('qiime-feature-table.tsv'));
  assert.strictEqual(result.format, 'qiime-biom-tsv');
  assert.strictEqual(result.confidence, 'high');
});

test('parseQiimeTaxonomy builds a rank path per feature ID, skipping empty trailing ranks', () => {
  const map = parseQiimeTaxonomy(read('qiime-taxonomy.tsv'));
  const f1 = map.get('f1');
  assert.strictEqual(f1.length, 7);
  assert.strictEqual(f1[f1.length - 1].rank, 'species');
  assert.strictEqual(f1[f1.length - 1].name, 'subtilis');

  const f3 = map.get('f3'); // trailing s__ empty
  assert.strictEqual(f3.length, 6);
  assert.strictEqual(f3[f3.length - 1].rank, 'genus');
});

test('parseQiimeTaxonomy gives an "Unassigned" feature an empty path', () => {
  const map = parseQiimeTaxonomy(read('qiime-taxonomy.tsv'));
  assert.strictEqual(map.get('f4').length, 0);
});

test('parseQiimeBiomTsv reads sample columns and per-feature counts, skipping zeros', () => {
  const { sampleIds, rows } = parseQiimeBiomTsv(read('qiime-feature-table.tsv'));
  assert.deepStrictEqual(sampleIds, ['sampleA', 'sampleB']);
  const f1 = rows.find((r) => r.featureId === 'f1');
  assert.strictEqual(f1.counts.get('sampleA'), 42);
  assert.strictEqual(f1.counts.has('sampleB'), false);
});

test('buildQiimeSamples builds one tree-backed sample per feature-table column', () => {
  const tree = new TaxonomyTree();
  const taxonomy = parseQiimeTaxonomy(read('qiime-taxonomy.tsv'));
  const { sampleIds, totalsBySample } = buildQiimeSamples(read('qiime-feature-table.tsv'), taxonomy, tree);

  assert.deepStrictEqual(sampleIds, ['sampleA', 'sampleB']);
  assert.strictEqual(totalsBySample.get('sampleA'), 67); // 42 + 17 + 5 + 3 unclassified
  assert.strictEqual(totalsBySample.get('sampleB'), 18); // 10 + 8 unclassified

  const summaryA = computeSampleSummary(tree, 'sampleA');
  assert.strictEqual(summaryA.classifiedReads, 64);
  assert.strictEqual(summaryA.unclassifiedReads, 3);
});

test('two samples sharing a feature merge onto the same tree node', () => {
  const tree = new TaxonomyTree();
  const taxonomy = parseQiimeTaxonomy(read('qiime-taxonomy.tsv'));
  buildQiimeSamples(read('qiime-feature-table.tsv'), taxonomy, tree);

  const { syntheticTaxid } = require('../src/parsers/lineage-tsv');
  const ecoliTaxid = syntheticTaxid(
    ['bacteria', 'proteobacteria', 'gammaproteobacteria', 'enterobacterales', 'enterobacteriaceae', 'escherichia', 'coli'].join(
      '|'
    )
  );
  const a = tree.getSampleCounts(ecoliTaxid, 'sampleA');
  const b = tree.getSampleCounts(ecoliTaxid, 'sampleB');
  assert.strictEqual(a.cladeReads, 17);
  assert.strictEqual(b.cladeReads, 10);
});

report();
