(function () {
  'use strict';

// Content-based format detection for Kraken2/Bracken input files.
// Never trusts file names/extensions — reads only the first N lines of content.
// See PLAN.md §1 "Content-based format detection" for the rules this implements.

const SNIFF_LINE_LIMIT = 20;

const BRACKEN_HEADER = [
  'name',
  'taxonomy_id',
  'taxonomy_lvl',
  'kraken_assigned_reads',
  'added_reads',
  'new_est_reads',
  'fraction_total_reads',
];

const RANK_CODE_RE = /^[A-Za-z][0-9]*$/;

function firstLines(text, limit = SNIFF_LINE_LIMIT) {
  const lines = [];
  let start = 0;
  while (lines.length < limit) {
    const idx = text.indexOf('\n', start);
    const line = idx === -1 ? text.slice(start) : text.slice(start, idx);
    if (line.trim().length > 0) lines.push(line.replace(/\r$/, ''));
    if (idx === -1) break;
    start = idx + 1;
  }
  return lines;
}

function isFloat0to100(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function isInteger(value) {
  return /^-?\d+$/.test(value.trim());
}

function isNumeric(value) {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

/**
 * Try matching the .bracken shape: 7 tab columns, literal header row.
 */
function sniffBracken(lines) {
  if (lines.length === 0) return null;
  const header = lines[0].split('\t');
  if (header.length !== 7) return null;
  const headerMatches = header.every(
    (col, i) => col.trim().toLowerCase() === BRACKEN_HEADER[i]
  );
  if (!headerMatches) return null;
  return { format: 'bracken', confidence: 'high', columns: header };
}

/**
 * Try matching the .breport shape: 6 tab columns, no header, column 1 is a
 * 0-100 percentage, column 4 is a rank code (letter + optional digits),
 * column 5 is an integer taxid.
 */
function sniffBreport(lines) {
  if (lines.length === 0) return null;
  const dataLines = lines.filter((l) => l.split('\t').length === 6);
  if (dataLines.length < Math.min(3, lines.length)) return null;

  let ok = 0;
  for (const line of dataLines) {
    const cols = line.split('\t');
    if (
      isFloat0to100(cols[0]) &&
      isInteger(cols[1]) &&
      isInteger(cols[2]) &&
      RANK_CODE_RE.test(cols[3].trim()) &&
      isInteger(cols[4])
    ) {
      ok++;
    }
  }
  if (ok / dataLines.length >= 0.9) {
    return { format: 'breport', confidence: 'high', columns: 6 };
  }
  return null;
}

/**
 * Best-effort generic tab-delimited fallback: needs >=2 columns, a
 * consistently numeric candidate abundance column, and a consistently
 * non-numeric candidate taxon-name column. Always returned as "unconfirmed"
 * confidence so the caller can require manual confirmation before treating
 * it as selected in a tick-list.
 */
function sniffGeneric(lines) {
  if (lines.length === 0) return null;
  const rows = lines.map((l) => l.split('\t')).filter((r) => r.length >= 2);
  if (rows.length === 0) return null;

  const colCount = Math.min(...rows.map((r) => r.length));
  if (colCount < 2) return null;

  const numericScore = new Array(colCount).fill(0);
  const textScore = new Array(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      if (isNumeric(row[c])) numericScore[c]++;
      else if (row[c].trim() !== '') textScore[c]++;
    }
  }

  let abundanceCol = -1;
  let maxNumeric = 0;
  for (let c = 0; c < colCount; c++) {
    if (numericScore[c] > maxNumeric) {
      maxNumeric = numericScore[c];
      abundanceCol = c;
    }
  }

  let nameCol = -1;
  let maxText = 0;
  for (let c = 0; c < colCount; c++) {
    if (c === abundanceCol) continue;
    if (textScore[c] > maxText) {
      maxText = textScore[c];
      nameCol = c;
    }
  }

  if (abundanceCol === -1 || nameCol === -1) return null;
  if (maxNumeric / rows.length < 0.7 || maxText / rows.length < 0.7) return null;

  return {
    format: 'generic',
    confidence: 'unconfirmed',
    columns: colCount,
    candidateAbundanceColumn: abundanceCol,
    candidateNameColumn: nameCol,
  };
}

/**
 * Detect the format of a text file's content. Returns a result object with
 * `format` ("bracken" | "breport" | "generic" | "unknown"), `confidence`
 * ("high" | "unconfirmed" | "none"), and a human-readable `reason` when
 * detection failed or was unconfirmed.
 */
function sniffFormat(text) {
  const lines = firstLines(text);
  if (lines.length === 0) {
    return { format: 'unknown', confidence: 'none', reason: 'file has no non-blank lines' };
  }

  const bracken = sniffBracken(lines);
  if (bracken) return bracken;

  const breport = sniffBreport(lines);
  if (breport) return breport;

  const generic = sniffGeneric(lines);
  if (generic) {
    return {
      ...generic,
      reason:
        'structurally tab-delimited with a plausible abundance/name column pair, but did not match the .bracken or .breport shape — confirm column mapping manually',
    };
  }

  return {
    format: 'unknown',
    confidence: 'none',
    reason: 'no tab-delimited numeric columns found in the first ' + SNIFF_LINE_LIMIT + ' lines',
  };
}

const sniffExports = { sniffFormat, firstLines, SNIFF_LINE_LIMIT };
if (typeof module !== 'undefined' && module.exports) module.exports = sniffExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.sniff = sniffExports;
}
})();
