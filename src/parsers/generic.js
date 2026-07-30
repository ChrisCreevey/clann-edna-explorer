(function () {
  'use strict';

// Best-effort generic tab-delimited parser for non-Kraken classifier output
// (Kaiju, Centrifuge, MetaPhlAn, ...). No taxonomic hierarchy is assumed —
// produces a flat list of {name, abundance} rows keyed by row index rather
// than taxid, since a generic report has no guaranteed taxid column.
//
// Column mapping is either the sniffer's best-guess candidate columns
// (see sniff.js sniffGeneric) or an explicit mapping supplied by the user
// after manual confirmation, per the brief's "manual column mapping if
// auto-detection fails" requirement.

function detectHeaderRow(firstLine, nameCol, abundanceCol) {
  const cols = firstLine.split('\t');
  const candidateAbundance = cols[abundanceCol];
  // If the sniffed "abundance" cell on the very first line isn't numeric,
  // that first line is almost certainly a header row.
  return candidateAbundance !== undefined && !Number.isFinite(Number(candidateAbundance.trim()));
}

/**
 * @param {string} text
 * @param {{nameColumn: number, abundanceColumn: number}} mapping
 * @returns {{rows: Array<{name: string, abundance: number}>, skippedHeaderRow: boolean}}
 */
function parseGeneric(text, mapping) {
  const { nameColumn, abundanceColumn } = mapping;
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [], skippedHeaderRow: false };

  const skippedHeaderRow = detectHeaderRow(lines[0], nameColumn, abundanceColumn);
  const dataLines = skippedHeaderRow ? lines.slice(1) : lines;

  const rows = [];
  for (const line of dataLines) {
    const cols = line.split('\t');
    if (cols.length <= Math.max(nameColumn, abundanceColumn)) continue;
    const name = cols[nameColumn].trim();
    const abundance = Number(cols[abundanceColumn]);
    if (name === '' || !Number.isFinite(abundance)) continue;
    rows.push({ name, abundance });
  }

  return { rows, skippedHeaderRow };
}

const genericExports = { parseGeneric, detectHeaderRow };
if (typeof module !== 'undefined' && module.exports) module.exports = genericExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.generic = genericExports;
}
})();
