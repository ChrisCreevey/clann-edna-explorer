const { test, report, assert } = require('./harness');
const {
  detectDelimiter,
  parseDelimited,
  readTable,
  guessMapping,
  validateMapping,
  layoutOf,
  buildLineageRows,
  importTable,
  parseLineageString,
  headerSignature,
} = require('../src/parsers/table-import');
const { sniffFormat } = require('../src/parsers/sniff');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');

console.log('table-import.js');

const roleOf = (table, mapping, header) => mapping.roles[table.header.indexOf(header)];

// Shape of a BOLD-style metabarcoding export: long layout, per-rank
// columns duplicated as BIN_* columns, distracting numeric columns, blank
// cells below the deepest resolved rank, Genus_species names.
const BOLD_LIKE = [
  'Sample\tOTU_ID\tTotal_Reads\tReplicates\tMean_Seq_Length\tID\tKingdom\tBIN_Kingdom\tPhylum\tClass\tOrder\tFamily\tBIN_Family\tGenus\tSpecies\tBIN_Species',
  'S1\tOTU_1\t3\t1\t658\t100.0\tAnimalia\tAnimalia\tArthropoda\tInsecta\tLepidoptera\tErebidae\tErebidae\t\t\t',
  'S1\tOTU_2\t5\t1\t658\t99.5\tAnimalia\tAnimalia\tArthropoda\tInsecta\tLepidoptera\tErebidae\tErebidae\tTriommatodes\tTriommatodes_costinotata\tTriommatodes_costinotata',
  'S2\tOTU_3\t7\t2\t650\t98.0\tAnimalia\tAnimalia\tArthropoda\tInsecta\tDiptera\tStratiomyidae\tStratiomyidae\t\t\t',
  'S2\tOTU_4\t2\t1\t640\t97.0\tNA\tNA\tNA\tNA\tNA\tNA\tNA\t\t\t',
].join('\n');

test('long BOLD-style table: guesses sample, count and exact rank columns, not the BIN_* duplicates', () => {
  const table = readTable(BOLD_LIKE);
  const mapping = guessMapping(table);
  assert.strictEqual(roleOf(table, mapping, 'Sample'), 'sample');
  assert.strictEqual(roleOf(table, mapping, 'Total_Reads'), 'count');
  assert.strictEqual(roleOf(table, mapping, 'Replicates'), 'ignore');
  assert.strictEqual(roleOf(table, mapping, 'Mean_Seq_Length'), 'ignore');
  assert.strictEqual(roleOf(table, mapping, 'ID'), 'ignore');
  assert.strictEqual(roleOf(table, mapping, 'Family'), 'rank:family');
  assert.strictEqual(roleOf(table, mapping, 'BIN_Family'), 'ignore');
  assert.strictEqual(roleOf(table, mapping, 'Species'), 'rank:species');
  assert.strictEqual(mapping.options.underscoresToSpaces, true);
  assert.strictEqual(layoutOf(mapping), 'long');
  assert.deepStrictEqual(validateMapping(mapping), []);
});

test('long table splits into one sample per Sample value, with paths stopping at the deepest filled rank', () => {
  const table = readTable(BOLD_LIKE);
  const { samples, stats } = buildLineageRows(table, guessMapping(table), 'unused');
  assert.deepStrictEqual([...samples.keys()], ['S1', 'S2']);
  const s1 = samples.get('S1').rows;
  assert.deepStrictEqual(
    s1[0].path.map((p) => p.name),
    ['Animalia', 'Arthropoda', 'Insecta', 'Lepidoptera', 'Erebidae']
  );
  assert.strictEqual(s1[1].path[s1[1].path.length - 1].name, 'Triommatodes costinotata');
  assert.strictEqual(samples.get('S2').unclassified, 2); // all-NA row
  assert.strictEqual(stats.deepestRank.species, 1);
  assert.strictEqual(stats.deepestRank.family, 2);
});

test('importTable builds clade totals in the shared tree for every sample', () => {
  const tree = new TaxonomyTree();
  const table = readTable(BOLD_LIKE);
  const { sampleIds } = importTable(BOLD_LIKE, guessMapping(table), tree, 'unused');
  assert.deepStrictEqual(sampleIds, ['S1', 'S2']);
  const idx = tree.name.indexOf('Erebidae');
  const counts = tree.perSample[idx].get('S1');
  assert.strictEqual(counts.cladeReads, 8);
  assert.strictEqual(counts.directReads, 3);
  assert.strictEqual(tree.getSampleCounts(0, 'S2').cladeReads, 2); // unclassified
});

test('wide CSV (DADA2/mothur style) with quoted fields: one sample per numeric column', () => {
  const csv = [
    'ASV,Kingdom,Phylum,Genus,"Sample A",SampleB',
    'ASV1,Bacteria,Firmicutes,"Bacillus",10,0',
    'ASV2,Bacteria,"Proteobacteria",Escherichia,0,4',
    'ASV3,Bacteria,Firmicutes,,2,3',
  ].join('\r\n');
  assert.strictEqual(detectDelimiter(csv), ',');
  const table = readTable(csv);
  const mapping = guessMapping(table);
  assert.strictEqual(roleOf(table, mapping, 'Sample A'), 'sample-count');
  assert.strictEqual(roleOf(table, mapping, 'SampleB'), 'sample-count');
  assert.strictEqual(layoutOf(mapping), 'wide');
  const { samples } = buildLineageRows(table, mapping, 'unused');
  assert.deepStrictEqual([...samples.keys()], ['Sample A', 'SampleB']);
  assert.strictEqual(samples.get('Sample A').rows.length, 2); // zero counts skipped
  assert.strictEqual(samples.get('SampleB').rows.length, 2);
});

test('MetaPhlAn-style table: commented header, prefixed lineage, cumulative rows dropped', () => {
  const text = [
    '#mpa_vJan21_CHOCOPhlAnSGB_202103',
    '#clade_name\tNCBI_tax_id\trelative_abundance\tadditional_species',
    'k__Bacteria\t2\t100.0\t',
    'k__Bacteria|p__Firmicutes\t2|1239\t60.0\t',
    'k__Bacteria|p__Firmicutes|c__Bacilli\t2|1239|91061\t60.0\t',
    'k__Bacteria|p__Proteobacteria\t2|1224\t40.0\t',
    'k__Bacteria|p__Proteobacteria|c__Gammaproteobacteria|s__Escherichia_coli\t2|1224|1236|562\t40.0\t',
  ].join('\n');
  const table = readTable(text);
  assert.strictEqual(table.header[0], 'clade_name');
  const mapping = guessMapping(table);
  assert.strictEqual(roleOf(table, mapping, 'clade_name'), 'lineage');
  assert.strictEqual(roleOf(table, mapping, 'relative_abundance'), 'count');
  assert.strictEqual(mapping.options.cumulativeRows, true);
  const { samples, stats } = buildLineageRows(table, mapping, 'mpa');
  const rows = samples.get('mpa').rows;
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(stats.cumulativeRowsDropped, 3);
  assert.deepStrictEqual(
    rows[1].path.map((p) => `${p.rank}:${p.name}`),
    ['kingdom:Bacteria', 'phylum:Proteobacteria', 'class:Gammaproteobacteria', 'species:Escherichia coli']
  );
});

test('Kaiju-style table: un-prefixed lineage read positionally, unclassified row counted', () => {
  const text = [
    'file\tpercent\treads\ttaxon_id\ttaxon_name',
    'run1.out\t50.0\t100\t562\tBacteria;Proteobacteria;Gammaproteobacteria;Enterobacterales;Enterobacteriaceae;Escherichia;Escherichia coli;',
    'run1.out\t50.0\t100\tNA\tunclassified',
  ].join('\n');
  const table = readTable(text);
  const mapping = guessMapping(table);
  assert.strictEqual(roleOf(table, mapping, 'file'), 'sample');
  assert.strictEqual(roleOf(table, mapping, 'reads'), 'count');
  assert.strictEqual(roleOf(table, mapping, 'percent'), 'ignore');
  assert.strictEqual(roleOf(table, mapping, 'taxon_name'), 'lineage');
  const { samples } = buildLineageRows(table, mapping, 'unused');
  const s = samples.get('run1.out');
  assert.strictEqual(s.unclassified, 100);
  assert.strictEqual(s.rows[0].path[0].rank, 'superkingdom');
  assert.strictEqual(s.rows[0].path[6].name, 'Escherichia coli');
});

test('name-only single-sample table maps the name column to species and counts reads', () => {
  const text = ['taxon\tcount\textra', 'Escherichia coli\t120\tfoo', 'Bacillus subtilis\t45\tbar'].join('\n');
  const table = readTable(text);
  const mapping = guessMapping(table);
  assert.strictEqual(roleOf(table, mapping, 'taxon'), 'rank:species');
  assert.strictEqual(roleOf(table, mapping, 'count'), 'count');
  assert.strictEqual(layoutOf(mapping), 'single');
  const { samples } = buildLineageRows(table, mapping, 'mine');
  assert.strictEqual(samples.get('mine').rows.length, 2);
});

test('species epithet-only column is prefixed with the genus when that option is on', () => {
  const text = ['genus\tspecies\tcount', 'Escherichia\tcoli\t3', 'Bacillus\tsubtilis\t4'].join('\n');
  const table = readTable(text);
  const mapping = guessMapping(table);
  assert.strictEqual(mapping.options.prefixGenusToSpecies, true);
  const { samples } = buildLineageRows(table, mapping, 'x');
  assert.strictEqual(samples.get('x').rows[0].path[1].name, 'Escherichia coli');
});

test('a mapped <rank>_taxid column supplies real taxids instead of synthetic ones', () => {
  const text = ['species\tspecies_taxid\tcount', 'Escherichia coli\t562\t3'].join('\n');
  const table = readTable(text);
  const mapping = guessMapping(table);
  assert.strictEqual(roleOf(table, mapping, 'species_taxid'), 'taxid:species');
  const { samples } = buildLineageRows(table, mapping, 'x');
  assert.strictEqual(samples.get('x').rows[0].path[0].taxid, 562);
});

test('no count column: each row counts as one read', () => {
  const text = ['read_id\tfamily\tgenus', 'r1\tEnterobacteriaceae\tEscherichia', 'r2\tEnterobacteriaceae\tEscherichia'].join('\n');
  const table = readTable(text);
  const mapping = guessMapping(table);
  assert.ok(!mapping.roles.includes('count'));
  const { samples } = buildLineageRows(table, mapping, 'x');
  assert.strictEqual(samples.get('x').rows.reduce((a, r) => a + r.count, 0), 2);
});

test('validateMapping flags missing taxonomy, duplicate roles and mixed layouts', () => {
  assert.ok(validateMapping({ roles: ['sample', 'count'], options: {} }).length > 0);
  assert.ok(validateMapping({ roles: ['rank:genus', 'rank:genus', 'count'], options: {} }).length > 0);
  assert.ok(validateMapping({ roles: ['rank:genus', 'sample', 'sample-count'], options: {} }).length > 0);
  assert.ok(validateMapping({ roles: ['rank:genus', 'lineage', 'count'], options: {} }).length > 0);
  assert.deepStrictEqual(validateMapping({ roles: ['rank:genus', 'count'], options: {} }), []);
});

test('parseDelimited handles escaped quotes and newlines inside quoted fields', () => {
  const rows = parseDelimited('a,"b ""q""","c\nd"\n1,2,3\n', ',');
  assert.deepStrictEqual(rows, [['a', 'b "q"', 'c\nd'], ['1', '2', '3']]);
});

test('SILVA D_n__ prefixes map to positional ranks', () => {
  const { path } = parseLineageString('D_0__Bacteria;D_1__Firmicutes;D_5__Bacillus', {});
  assert.deepStrictEqual(path.map((p) => p.rank), ['superkingdom', 'phylum', 'genus']);
});

test('headerSignature is stable for the same header regardless of case', () => {
  const a = readTable('Genus\tCount\nX\t1');
  const b = readTable('genus\tcount\nY\t2');
  assert.strictEqual(headerSignature(a), headerSignature(b));
});

test('sniffer offers any delimited non-native table as generic with a suggested mapping', () => {
  const result = sniffFormat(BOLD_LIKE);
  assert.strictEqual(result.format, 'generic');
  assert.strictEqual(result.confidence, 'unconfirmed');
  assert.strictEqual(result.mapping.roles[0], 'sample');
  assert.deepStrictEqual(result.mappingErrors, []);
});

test('sniffer reads comma-separated tables too', () => {
  const result = sniffFormat('genus,count\nEscherichia,3\nBacillus,4\n');
  assert.strictEqual(result.format, 'generic');
  assert.strictEqual(result.mapping.delimiter, ',');
});

report();
