const { test, report, assert } = require('./harness');
const { parseGeneric } = require('../src/parsers/generic');

console.log('generic.js');

test('parses a generic tab-delimited report with a header row', () => {
  const text = [
    'taxon\tcount',
    'Escherichia coli\t120',
    'Bacillus subtilis\t45',
  ].join('\n');
  const { rows, skippedHeaderRow } = parseGeneric(text, { nameColumn: 0, abundanceColumn: 1 });
  assert.strictEqual(skippedHeaderRow, true);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], { name: 'Escherichia coli', abundance: 120 });
});

test('parses a generic report with no header row', () => {
  const text = ['Escherichia coli\t120', 'Bacillus subtilis\t45'].join('\n');
  const { rows, skippedHeaderRow } = parseGeneric(text, { nameColumn: 0, abundanceColumn: 1 });
  assert.strictEqual(skippedHeaderRow, false);
  assert.strictEqual(rows.length, 2);
});

test('respects an explicit manual column mapping when columns are reordered', () => {
  const text = ['120\tEscherichia coli', '45\tBacillus subtilis'].join('\n');
  const { rows } = parseGeneric(text, { nameColumn: 1, abundanceColumn: 0 });
  assert.deepStrictEqual(rows[0], { name: 'Escherichia coli', abundance: 120 });
});

test('skips malformed rows rather than throwing', () => {
  const text = ['Escherichia coli\t120', 'malformed-row-no-tab', 'Bacillus subtilis\t45'].join('\n');
  const { rows } = parseGeneric(text, { nameColumn: 0, abundanceColumn: 1 });
  assert.strictEqual(rows.length, 2);
});

report();
