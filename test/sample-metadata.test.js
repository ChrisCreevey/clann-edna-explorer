const { test, report, assert } = require('./harness');
const { parseSampleMetadata, matchSummary, detectDelimiter } = require('../src/parsers/sample-metadata');

console.log('sample-metadata.js');

test('detectDelimiter picks tab when tabs outnumber commas', () => {
  assert.strictEqual(detectDelimiter('id\tsite\tdate'), '\t');
});

test('detectDelimiter picks comma when commas outnumber tabs', () => {
  assert.strictEqual(detectDelimiter('id,site,date'), ',');
});

test('parses a tab-delimited sample metadata file', () => {
  const text = 'barcode\tsite\tdepth\nbarcode39\tPondA\t2m\nbarcode40\tPondB\t5m\n';
  const meta = parseSampleMetadata(text);
  assert.strictEqual(meta.idColumnName, 'barcode');
  assert.deepStrictEqual(meta.fieldNames, ['site', 'depth']);
  assert.deepStrictEqual(meta.rowsById.get('barcode39'), { site: 'PondA', depth: '2m' });
  assert.deepStrictEqual(meta.rowsById.get('barcode40'), { site: 'PondB', depth: '5m' });
});

test('parses a comma-delimited sample metadata file', () => {
  const text = 'id,treatment\nbarcode39,Control\nbarcode40,Treated\n';
  const meta = parseSampleMetadata(text);
  assert.strictEqual(meta.idColumnName, 'id');
  assert.deepStrictEqual(meta.rowsById.get('barcode40'), { treatment: 'Treated' });
});

test('skips blank lines and rows with no ID', () => {
  const text = 'id,treatment\nbarcode39,Control\n\n,Orphan\n';
  const meta = parseSampleMetadata(text);
  assert.strictEqual(meta.rowsById.size, 1);
});

test('handles a missing trailing column as an empty string, not undefined', () => {
  const text = 'id,site,depth\nbarcode39,PondA\n';
  const meta = parseSampleMetadata(text);
  assert.strictEqual(meta.rowsById.get('barcode39').depth, '');
});

test('empty input returns an empty, well-formed result rather than throwing', () => {
  const meta = parseSampleMetadata('');
  assert.deepStrictEqual(meta, { idColumnName: '', fieldNames: [], rowsById: new Map() });
});

test('matchSummary reports matched samples, unmatched loaded samples, and unmatched metadata rows', () => {
  const meta = parseSampleMetadata('id,site\nbarcode39,PondA\nbarcode99,PondZ\n');
  const summary = matchSummary(['barcode39', 'barcode40'], meta);
  assert.deepStrictEqual(summary.matched, ['barcode39']);
  assert.deepStrictEqual(summary.unmatchedSamples, ['barcode40']);
  assert.deepStrictEqual(summary.unmatchedRows, ['barcode99']);
});

report();
