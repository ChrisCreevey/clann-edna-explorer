const { test, report, assert } = require('./harness');
const { csvEscape, toCsv, rankTableToCsv, abundanceMatrixToCsv, diversitySummaryToCsv, distanceMatrixToCsv } = require('../src/model/csv-export');

console.log('csv-export.js');

test('csvEscape quotes values containing commas, quotes, or newlines', () => {
  assert.strictEqual(csvEscape('plain'), 'plain');
  assert.strictEqual(csvEscape('has,comma'), '"has,comma"');
  assert.strictEqual(csvEscape('has "quote"'), '"has ""quote"""');
  assert.strictEqual(csvEscape('line1\nline2'), '"line1\nline2"');
});

test('csvEscape treats null/undefined as an empty cell', () => {
  assert.strictEqual(csvEscape(null), '');
  assert.strictEqual(csvEscape(undefined), '');
});

test('toCsv joins rows with commas and trailing newline', () => {
  assert.strictEqual(toCsv([['a', 'b'], ['c', 'd']]), 'a,b\nc,d\n');
});

test('rankTableToCsv includes the sample and group as repeated columns, self-describing per-row', () => {
  const rows = [
    { name: 'Coccinella transversoguttata', taxid: 1790162, cladeReads: 33764, pctOfTotal: 5.95 },
    { name: 'Cataglyphis aenescens', taxid: 606501, cladeReads: 79060, pctOfTotal: 13.93 },
  ];
  const csv = rankTableToCsv(rows, 'barcode39', 'Soil');
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines[0], 'Sample,Group,Taxon,Taxid,Reads,PercentOfTotal');
  assert.strictEqual(lines[1], 'barcode39,Soil,Coccinella transversoguttata,1790162,33764,5.950000');
});

test('rankTableToCsv handles an unassigned group as an empty cell, not "undefined"', () => {
  const rows = [{ name: 'A', taxid: 1, cladeReads: 10, pctOfTotal: 100 }];
  const csv = rankTableToCsv(rows, 'barcode39', null);
  assert.ok(csv.includes('barcode39,,A,1,10,100.000000'));
});

test('abundanceMatrixToCsv puts a Group row right under the sample-name header', () => {
  const matrix = {
    taxa: [{ taxid: 1790162, name: 'Coccinella transversoguttata' }],
    sampleIds: ['barcode39', 'barcode40'],
    matrix: [[33764, 98]],
  };
  const csv = abundanceMatrixToCsv(matrix, { barcode39: 'Soil', barcode40: 'Water' });
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines[0], 'Taxon,Taxid,barcode39,barcode40');
  assert.strictEqual(lines[1], 'Group,,Soil,Water');
  assert.strictEqual(lines[2], 'Coccinella transversoguttata,1790162,33764,98');
});

test('abundanceMatrixToCsv leaves an unmapped sample\'s group cell blank', () => {
  const matrix = { taxa: [], sampleIds: ['barcode39'], matrix: [] };
  const csv = abundanceMatrixToCsv(matrix, {});
  assert.ok(csv.includes('Group,,\n') || csv.trim().split('\n')[1] === 'Group,');
});

test('diversitySummaryToCsv lists per-sample rows then per-group aggregate rows', () => {
  const summary = {
    perSample: [
      { id: 'barcode39', group: 'Soil', richness: 454, shannon: 3.2, simpson: 0.9 },
      { id: 'barcode40', group: 'Soil', richness: 30, shannon: 2.1, simpson: 0.7 },
    ],
    groupAggregates: new Map([['Soil', { richness: { mean: 242 }, shannon: { mean: 2.65 }, simpson: { mean: 0.8 } }]]),
  };
  const lines = diversitySummaryToCsv(summary).trim().split('\n');
  assert.strictEqual(lines[0], 'Sample,Group,Richness,Shannon,Simpson');
  assert.strictEqual(lines[1], 'barcode39,Soil,454,3.200000,0.900000');
  assert.strictEqual(lines[3], 'Soil (mean),Soil,242.000,2.650000,0.800000');
});

test('distanceMatrixToCsv produces a square sample x sample grid matching sampleIds order', () => {
  const distance = { sampleIds: ['a', 'b'], matrix: [[0, 0.5], [0.5, 0]] };
  const lines = distanceMatrixToCsv(distance).trim().split('\n');
  assert.strictEqual(lines[0], ',a,b');
  assert.strictEqual(lines[1], 'a,0.000000,0.500000');
  assert.strictEqual(lines[2], 'b,0.500000,0.000000');
});

report();
