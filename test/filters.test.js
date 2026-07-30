const { test, report, assert } = require('./harness');
const { parseExclusionList, isRowExcluded, applyExclusionList, applyMinAbundance, applyFilters, matchesSearch } = require('../src/model/filters');

console.log('filters.js');

test('parseExclusionList splits on commas and newlines, trims, dedupes case-insensitively', () => {
  assert.deepStrictEqual(parseExclusionList('Homo sapiens, Bos taurus\nHomo sapiens'), ['Homo sapiens', 'Bos taurus']);
  assert.deepStrictEqual(parseExclusionList(''), []);
});

test('isRowExcluded matches by exact case-insensitive name, not substring', () => {
  const row = { taxid: 9606, name: 'Homo sapiens' };
  assert.strictEqual(isRowExcluded(row, ['homo sapiens']), true);
  assert.strictEqual(isRowExcluded(row, ['Homo']), false); // no accidental substring exclusion
});

test('isRowExcluded matches by exact taxid', () => {
  const row = { taxid: 9606, name: 'Homo sapiens' };
  assert.strictEqual(isRowExcluded(row, ['9606']), true);
});

test('applyExclusionList removes matching rows and renormalizes pctOfTotal against the remaining reads', () => {
  const rows = [
    { taxid: 1, name: 'Homo sapiens', cladeReads: 900, pctOfTotal: 90 },
    { taxid: 2, name: 'Species A', cladeReads: 60, pctOfTotal: 6 },
    { taxid: 3, name: 'Species B', cladeReads: 40, pctOfTotal: 4 },
  ];
  const { rows: kept, removedCount, removedReads } = applyExclusionList(rows, ['Homo sapiens']);
  assert.strictEqual(removedCount, 1);
  assert.strictEqual(removedReads, 900);
  assert.strictEqual(kept.length, 2);
  // remaining total is 100 reads now, so Species A goes from 6% -> 60%
  assert.strictEqual(kept.find((r) => r.taxid === 2).pctOfTotal, 60);
  assert.strictEqual(kept.find((r) => r.taxid === 3).pctOfTotal, 40);
});

test('applyExclusionList with no terms is a no-op', () => {
  const rows = [{ taxid: 1, name: 'A', cladeReads: 10, pctOfTotal: 100 }];
  const { rows: kept, removedCount } = applyExclusionList(rows, []);
  assert.strictEqual(removedCount, 0);
  assert.strictEqual(kept, rows);
});

test('applyMinAbundance filters by percentage without renormalizing', () => {
  const rows = [
    { taxid: 1, cladeReads: 90, pctOfTotal: 90 },
    { taxid: 2, cladeReads: 10, pctOfTotal: 10 },
  ];
  const result = applyMinAbundance(rows, { mode: 'pct', value: 50 });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taxid, 1);
  assert.strictEqual(result[0].pctOfTotal, 90); // unchanged, no renormalization
});

test('applyMinAbundance filters by read count', () => {
  const rows = [
    { taxid: 1, cladeReads: 500 },
    { taxid: 2, cladeReads: 5 },
  ];
  const result = applyMinAbundance(rows, { mode: 'reads', value: 100 });
  assert.deepStrictEqual(result.map((r) => r.taxid), [1]);
});

test('applyMinAbundance with value 0 is a no-op', () => {
  const rows = [{ taxid: 1, cladeReads: 1, pctOfTotal: 0.001 }];
  assert.strictEqual(applyMinAbundance(rows, { mode: 'pct', value: 0 }), rows);
});

test('applyFilters applies exclusion before the abundance threshold (threshold judges post-exclusion abundance)', () => {
  const rows = [
    { taxid: 1, name: 'Homo sapiens', cladeReads: 900, pctOfTotal: 90 },
    { taxid: 2, name: 'Species A', cladeReads: 60, pctOfTotal: 6 },
    { taxid: 3, name: 'Species B', cladeReads: 40, pctOfTotal: 4 },
  ];
  // After excluding Homo sapiens, Species A is 60% and Species B is 40% of
  // the remaining 100 reads — a 50% threshold should now keep only A.
  const { rows: result } = applyFilters(rows, {
    exclusionTerms: ['Homo sapiens'],
    minAbundance: { mode: 'pct', value: 50 },
  });
  assert.deepStrictEqual(result.map((r) => r.taxid), [2]);
});

test('applyFilters with null filters is a no-op', () => {
  const rows = [{ taxid: 1, name: 'A', cladeReads: 10, pctOfTotal: 100 }];
  const { rows: result } = applyFilters(rows, null);
  assert.strictEqual(result, rows);
});

test('matchesSearch matches by substring on name or exact taxid', () => {
  assert.strictEqual(matchesSearch('Coccinella transversoguttata', 1790162, 'coccinella'), true);
  assert.strictEqual(matchesSearch('Coccinella transversoguttata', 1790162, '1790162'), true);
  assert.strictEqual(matchesSearch('Coccinella transversoguttata', 1790162, 'volucella'), false);
  assert.strictEqual(matchesSearch('Coccinella transversoguttata', 1790162, ''), false);
});

report();
