// Parser for Kraken-style .breport files: one row per taxonomy tree node,
// hierarchy encoded via leading-space indentation on the name column (2
// spaces per depth level — confirmed against real barcode39-45 example
// files, see PLAN.md §1). No header row.
//
// Columns: pct_reads_rooted, reads_covered(clade), reads_assigned(direct),
// rank_code, taxid, indented_name.
//
// Streams line-by-line rather than building an intermediate array of every
// line, per the brief's streaming-parse performance requirement.

function parseBreportLine(line) {
  const cols = line.split('\t');
  if (cols.length !== 6) return null;
  const [pctStr, cladeStr, directStr, rankCode, taxidStr, rawName] = cols;

  const leadingSpaces = rawName.length - rawName.replace(/^ +/, '').length;
  const depth = leadingSpaces / 2;

  return {
    pctOfTotal: Number(pctStr),
    cladeReads: Number(cladeStr),
    directReads: Number(directStr),
    rankCode: rankCode.trim(),
    taxid: Number(taxidStr),
    name: rawName.trim(),
    depth,
  };
}

/**
 * Parse .breport text and attach nodes/counts into the given shared
 * TaxonomyTree for `sampleId`. Returns summary stats for the sample.
 *
 * @param {string} text - full file contents
 * @param {import('../model/taxonomy-tree').TaxonomyTree} tree
 * @param {string} sampleId
 */
function parseBreport(text, tree, sampleId) {
  const lines = text.split(/\r?\n/);
  // stack[d] = taxid of the current open ancestor at depth d
  const stack = [];
  let rowCount = 0;
  let rootCladeReads = 0;

  for (const rawLine of lines) {
    if (rawLine.trim() === '') continue;
    const row = parseBreportLine(rawLine);
    if (!row) continue;
    rowCount++;

    const parentTaxid = row.depth === 0 ? null : stack[row.depth - 1] ?? null;
    tree.getOrCreateNode(row.taxid, row.name, row.rankCode, row.depth, parentTaxid);
    tree.setSampleCounts(row.taxid, sampleId, {
      cladeReads: row.cladeReads,
      directReads: row.directReads,
      pctOfTotal: row.pctOfTotal,
    });

    stack[row.depth] = row.taxid;
    stack.length = row.depth + 1;

    if (row.depth === 0) rootCladeReads = row.cladeReads;
  }

  return {
    rowCount,
    totalReads: rootCladeReads,
  };
}

const breportExports = { parseBreport, parseBreportLine };
if (typeof module !== 'undefined' && module.exports) module.exports = breportExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.breport = breportExports;
}
