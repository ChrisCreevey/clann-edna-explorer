const { test, report, assert } = require('./harness');
const { EXCLUDE, parseGroupNames, resolveSampleGroup, summarizeGroups } = require('../src/model/groups');

console.log('groups.js');

test('parses a comma-separated group list, trimming whitespace', () => {
  assert.deepStrictEqual(parseGroupNames('Soil, Vegetation, Water'), ['Soil', 'Vegetation', 'Water']);
  assert.deepStrictEqual(parseGroupNames('  Soil ,Vegetation ,  Water  '), ['Soil', 'Vegetation', 'Water']);
});

test('drops empty entries and de-duplicates while preserving order', () => {
  assert.deepStrictEqual(parseGroupNames('Soil,,Water,Soil'), ['Soil', 'Water']);
  assert.deepStrictEqual(parseGroupNames(''), []);
  assert.deepStrictEqual(parseGroupNames(undefined), []);
});

test('resolveSampleGroup: Exclude is always valid regardless of the group list', () => {
  assert.strictEqual(resolveSampleGroup(EXCLUDE, []), EXCLUDE);
  assert.strictEqual(resolveSampleGroup(EXCLUDE, ['Soil']), EXCLUDE);
});

test('resolveSampleGroup: a valid group assignment is kept', () => {
  assert.strictEqual(resolveSampleGroup('Soil', ['Soil', 'Water']), 'Soil');
});

test('resolveSampleGroup: a stale assignment (group removed from the list) falls back to unassigned', () => {
  assert.strictEqual(resolveSampleGroup('Soil', ['Water']), null);
});

test('resolveSampleGroup: null/undefined stays unassigned', () => {
  assert.strictEqual(resolveSampleGroup(null, ['Soil']), null);
  assert.strictEqual(resolveSampleGroup(undefined, ['Soil']), null);
});

function samplesMap(entries) {
  return new Map(entries.map(([id, group]) => [id, { id, group }]));
}

test('summarizeGroups buckets samples by group, excluded, and unassigned', () => {
  const samples = samplesMap([
    ['a', 'Soil'],
    ['b', 'Water'],
    ['c', 'Soil'],
    ['d', EXCLUDE],
    ['e', null],
  ]);
  const summary = summarizeGroups(samples, ['Soil', 'Water']);
  assert.deepStrictEqual(summary.byGroup.get('Soil'), ['a', 'c']);
  assert.deepStrictEqual(summary.byGroup.get('Water'), ['b']);
  assert.deepStrictEqual(summary.excluded, ['d']);
  assert.deepStrictEqual(summary.unassigned, ['e']);
  assert.deepStrictEqual(summary.included, ['a', 'c', 'b']);
  assert.strictEqual(summary.singleGroup, false);
});

test('summarizeGroups: stale group assignments (group retyped away) fall back to unassigned', () => {
  const samples = samplesMap([['a', 'OldGroupName']]);
  const summary = summarizeGroups(samples, ['NewGroupName']);
  assert.deepStrictEqual(summary.unassigned, ['a']);
  assert.deepStrictEqual(summary.included, []);
});

test('summarizeGroups: singleGroup is true when every included sample shares one group', () => {
  const samples = samplesMap([
    ['a', 'Soil'],
    ['b', 'Soil'],
    ['c', EXCLUDE],
  ]);
  const summary = summarizeGroups(samples, ['Soil', 'Water']);
  assert.strictEqual(summary.singleGroup, true);
});

test('summarizeGroups: singleGroup is true with zero groups too (no false multi-group state)', () => {
  const samples = samplesMap([['a', null]]);
  const summary = summarizeGroups(samples, []);
  assert.strictEqual(summary.singleGroup, true);
});

report();
