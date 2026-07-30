const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { captureProvenance } = require('../src/parsers/provenance');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('provenance.js');

test('real barcode39.breport has no leading comment block (confirmed non-feature, PLAN.md §1)', () => {
  assert.strictEqual(captureProvenance(read('barcode39.breport')), null);
});

test('real barcode39.bracken has no leading comment block (confirmed non-feature, PLAN.md §1)', () => {
  assert.strictEqual(captureProvenance(read('barcode39.bracken')), null);
});

test('captures a hypothetical Galaxy-style leading comment block, defensively', () => {
  const text = [
    '# tool_version: kraken2 2.1.2',
    '# database: PlusPF_20221209',
    '# original_sample_name: barcode39',
    'name\ttaxonomy_id\ttaxonomy_lvl\tkraken_assigned_reads\tadded_reads\tnew_est_reads\tfraction_total_reads',
    'Coccinella transversoguttata\t1790162\tS\t31012\t2752\t33764\t0.05950',
  ].join('\n');
  const provenance = captureProvenance(text);
  assert.strictEqual(provenance.tool_version, 'kraken2 2.1.2');
  assert.strictEqual(provenance.database, 'PlusPF_20221209');
  assert.strictEqual(provenance.original_sample_name, 'barcode39');
});

report();
