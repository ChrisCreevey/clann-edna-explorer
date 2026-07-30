(function () {
  'use strict';

// Header/provenance metadata capture (tool version, database, original
// sample name, command invocation) from leading comment lines.
//
// Confirmed absent in command-line-generated Kraken2/Bracken output (all 7
// example barcodes have zero leading '#'/'"' lines) — see PLAN.md §1. This
// is a documented non-feature for that case: the check below degrades
// silently to `null` rather than misparsing, so it stays harmless if a
// Galaxy export (unverified — brief flags these may prepend such a block)
// turns out to carry one.

const COMMENT_PREFIXES = ['#'];

/**
 * @param {string} text
 * @returns {Record<string,string>|null} captured key/value provenance
 *   fields, or null if no recognisable leading comment block was found.
 */
function captureProvenance(text) {
  const lines = text.split(/\r?\n/);
  const commentLines = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (COMMENT_PREFIXES.some((p) => line.startsWith(p))) {
      commentLines.push(line.replace(/^#+\s*/, ''));
      continue;
    }
    break; // first non-comment, non-blank line ends the header block
  }

  if (commentLines.length === 0) return null;

  const provenance = {};
  for (const line of commentLines) {
    const m = /^([^:=]+)[:=]\s*(.+)$/.exec(line);
    if (m) provenance[m[1].trim()] = m[2].trim();
  }
  return Object.keys(provenance).length > 0 ? provenance : { raw: commentLines.join('\n') };
}

const provenanceExports = { captureProvenance };
if (typeof module !== 'undefined' && module.exports) module.exports = provenanceExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.provenance = provenanceExports;
}
})();
