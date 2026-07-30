const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { sniffFormat } = require('../src/parsers/sniff');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('sniff.js');

test('detects a real .bracken file by content', () => {
  const result = sniffFormat(read('barcode39.bracken'));
  assert.strictEqual(result.format, 'bracken');
  assert.strictEqual(result.confidence, 'high');
});

test('detects a real .breport file by content', () => {
  const result = sniffFormat(read('barcode39.breport'));
  assert.strictEqual(result.format, 'breport');
  assert.strictEqual(result.confidence, 'high');
});

test('detects .bracken/.breport even with a Galaxy-style misleading filename (content, not name)', () => {
  // simulate a Galaxy export: same content, name tells us nothing
  const brackenResult = sniffFormat(read('barcode40.bracken'));
  const breportResult = sniffFormat(read('barcode40.breport'));
  assert.strictEqual(brackenResult.format, 'bracken');
  assert.strictEqual(breportResult.format, 'breport');
});

test('rejects an unrelated file with a clear reason', () => {
  const result = sniffFormat('just some\nplain text\nwith no structure\n');
  assert.strictEqual(result.format, 'unknown');
  assert.ok(result.reason.length > 0);
});

test('flags a generic tab-delimited file as unconfirmed, not silently accepted', () => {
  const genericText = [
    'taxon\tcount\textra',
    'Escherichia coli\t120\tfoo',
    'Bacillus subtilis\t45\tbar',
    'Pseudomonas putida\t9\tbaz',
  ].join('\n');
  const result = sniffFormat(genericText);
  assert.strictEqual(result.format, 'generic');
  assert.strictEqual(result.confidence, 'unconfirmed');
});

test('empty file is reported as unknown, not crashed on', () => {
  const result = sniffFormat('');
  assert.strictEqual(result.format, 'unknown');
});

report();
