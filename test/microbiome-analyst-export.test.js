const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const {
  buildMicrobiomeAnalystExport,
  sanitizeIdentifier,
  sanitizeAndDedupe,
  resolveRankNames,
} = require('../src/model/microbiome-analyst-export');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('microbiome-analyst-export.js');

function loadTree() {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBreport(read('barcode40.breport'), tree, 'barcode40');
  parseBreport(read('barcode42.breport'), tree, 'barcode42');
  return tree;
}

test('sanitizeIdentifier replaces disallowed characters one-for-one with underscores', () => {
  assert.strictEqual(sanitizeIdentifier('Soil samples'), 'Soil_samples');
  assert.strictEqual(sanitizeIdentifier('barcode-39'), 'barcode_39');
  assert.strictEqual(sanitizeIdentifier('A/B'), 'A_B');
  assert.strictEqual(sanitizeIdentifier('already_valid_123'), 'already_valid_123');
});

test('sanitizeAndDedupe resolves collisions introduced by sanitization', () => {
  const { map, changes } = sanitizeAndDedupe(['Soil A', 'Soil_A', 'Water']);
  assert.strictEqual(map.get('Soil A'), 'Soil_A');
  assert.strictEqual(map.get('Soil_A'), 'Soil_A_2');
  assert.strictEqual(map.get('Water'), 'Water');
  assert.strictEqual(changes.length, 2); // "Soil A" and "Soil_A" both changed (the second to avoid collision)
});

test('sanitizeAndDedupe is a no-op for already-clean, unique labels', () => {
  const { map, changes } = sanitizeAndDedupe(['barcode39', 'barcode40']);
  assert.strictEqual(map.get('barcode39'), 'barcode39');
  assert.strictEqual(changes.length, 0);
});

test('resolveRankNames finds the known species\' full lineage (Kingdom..Species)', () => {
  const tree = loadTree();
  const treeIndex = tree.taxidToIndex.get(1790162); // Coccinella transversoguttata
  const names = resolveRankNames(tree, treeIndex);
  assert.strictEqual(names.S, 'Coccinella transversoguttata');
  assert.ok(names.K.length > 0); // Kingdom resolved
  assert.ok(names.P.length > 0); // Phylum resolved
});

test('resolveRankNames leaves unresolved ranks blank, not throwing', () => {
  const tree = loadTree();
  // The root itself has no Kingdom..Species ancestors resolved below it
  const rootIndex = tree.taxidToIndex.get(1);
  const names = resolveRankNames(tree, rootIndex);
  assert.strictEqual(names.S, '');
});

test('abundance table: #NAME header row, taxid-keyed rows, counts not percentages', () => {
  const tree = loadTree();
  const result = buildMicrobiomeAnalystExport(
    tree,
    ['barcode39', 'barcode40', 'barcode42'],
    'S',
    [
      { id: 'barcode39', group: 'Soil' },
      { id: 'barcode40', group: 'Water' },
      { id: 'barcode42', group: 'Water' },
    ]
  );
  const lines = result.abundanceTableText.trim().split('\n');
  assert.strictEqual(lines[0], '#NAME\tbarcode39\tbarcode40\tbarcode42');
  const knownRow = lines.find((l) => l.startsWith('1790162\t'));
  assert.ok(knownRow);
  const cols = knownRow.split('\t');
  assert.strictEqual(cols[1], '33764'); // raw read count, not a percentage
});

test('taxonomy mapping: #TAXONOMY header with the 7 spec columns, rows match abundance table taxids', () => {
  const tree = loadTree();
  const result = buildMicrobiomeAnalystExport(tree, ['barcode39', 'barcode40'], 'S', [
    { id: 'barcode39', group: 'Soil' },
    { id: 'barcode40', group: 'Water' },
  ]);
  const taxLines = result.taxonomyMappingText.trim().split('\n');
  assert.strictEqual(taxLines[0], '#TAXONOMY\tKingdom\tPhylum\tClass\tOrder\tFamily\tGenus\tSpecies');

  const abundanceTaxids = result.abundanceTableText
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split('\t')[0]);
  const taxonomyTaxids = taxLines.slice(1).map((l) => l.split('\t')[0]);
  assert.deepStrictEqual(taxonomyTaxids, abundanceTaxids);

  const knownRow = taxLines.find((l) => l.startsWith('1790162\t'));
  assert.ok(knownRow.endsWith('Coccinella transversoguttata'));
});

test('metadata: #NAME header, Group as primary column, sample and group values sanitized', () => {
  const tree = loadTree();
  const result = buildMicrobiomeAnalystExport(tree, ['barcode39', 'barcode40'], 'S', [
    { id: 'barcode39', group: 'Soil samples' },
    { id: 'barcode40', group: 'Water' },
  ]);
  const lines = result.metadataText.trim().split('\n');
  assert.strictEqual(lines[0], '#NAME\tGroup');
  assert.strictEqual(lines[1], 'barcode39\tSoil_samples');
  assert.strictEqual(lines[2], 'barcode40\tWater');
});

test('metadata: unassigned samples get an explicit non-empty placeholder, never a blank cell', () => {
  const tree = loadTree();
  const result = buildMicrobiomeAnalystExport(tree, ['barcode39', 'barcode40'], 'S', [
    { id: 'barcode39', group: 'Unassigned' },
    { id: 'barcode40', group: 'Water' },
  ]);
  const lines = result.metadataText.trim().split('\n');
  assert.strictEqual(lines[1], 'barcode39\tUnassigned');
});

test('warns (does not throw/block) when a group has fewer than 3 replicates', () => {
  const tree = loadTree();
  const result = buildMicrobiomeAnalystExport(tree, ['barcode39', 'barcode40'], 'S', [
    { id: 'barcode39', group: 'Soil' },
    { id: 'barcode40', group: 'Water' },
  ]);
  assert.strictEqual(result.warnings.length, 2); // both groups have only 1 sample
  assert.ok(result.warnings[0].includes('at least 3 replicates'));
});

test('no warning when every group meets the 3-replicate minimum', () => {
  const tree = loadTree();
  const result = buildMicrobiomeAnalystExport(tree, ['barcode39', 'barcode40', 'barcode42'], 'S', [
    { id: 'barcode39', group: 'Soil' },
    { id: 'barcode40', group: 'Soil' },
    { id: 'barcode42', group: 'Soil' },
  ]);
  assert.strictEqual(result.warnings.length, 0);
});

test('respects the exclusion filter — an excluded taxon does not appear in the abundance or taxonomy tables', () => {
  const tree = loadTree();
  const result = buildMicrobiomeAnalystExport(
    tree,
    ['barcode39', 'barcode40'],
    'S',
    [
      { id: 'barcode39', group: 'Soil' },
      { id: 'barcode40', group: 'Water' },
    ],
    { filters: { exclusionTerms: ['Coccinella transversoguttata'] } }
  );
  assert.ok(!result.abundanceTableText.includes('1790162'));
  assert.ok(!result.taxonomyMappingText.includes('1790162'));
});

test('sanitizationChanges reports every label that was actually altered', () => {
  const tree = loadTree();
  const result = buildMicrobiomeAnalystExport(tree, ['barcode39'], 'S', [{ id: 'barcode39', group: 'Soil samples' }]);
  assert.ok(result.sanitizationChanges.some((c) => c.original === 'Soil samples' && c.sanitized === 'Soil_samples'));
});

report();
