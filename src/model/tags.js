// Taxon category tagging (brief: "Taxon category tagging by keyword match
// against taxon name, or by uploaded taxid/name list, for highlighting
// taxa of interest ... consistently across Krona, Sankey, and table
// views"). Two independent, combinable sources of tags:
//
//  - an uploaded two-column taxid/name -> category list (exact match)
//  - free-typed keyword rules ("keyword => category", substring match)
//
// A taxon can only carry one category in this app (kept simple — v1 is
// about highlighting taxa of interest, not building a full multi-label
// tagging system); an exact uploaded match always wins over a keyword
// rule, and the first matching keyword rule wins among keyword rules.

(function () {
  'use strict';

  // Detects across every line, not just the first — a single malformed
  // leading line (missing the real delimiter entirely) shouldn't throw
  // off detection for the rest of an otherwise well-formed list.
  function detectDelimiter(text) {
    const tabCount = (text.match(/\t/g) || []).length;
    const commaCount = (text.match(/,/g) || []).length;
    return tabCount >= commaCount ? '\t' : ',';
  }

  /**
   * Two-column taxid/name -> category list. Keyed by lowercased name or
   * exact taxid string, mirroring filters.js's exclusion-list matching so
   * the two "type a taxon identifier" features behave the same way.
   */
  function parseTaxonTagList(text) {
    const lines = (text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return new Map();
    const delimiter = detectDelimiter(lines.join('\n'));
    const map = new Map();
    lines.forEach((line) => {
      const [rawKey, rawCategory] = line.split(delimiter);
      if (!rawKey || !rawCategory) return;
      const key = rawKey.trim().toLowerCase();
      const category = rawCategory.trim();
      if (!key || !category) return;
      map.set(key, category);
    });
    return map;
  }

  /**
   * One rule per line: "keyword => category" or "keyword, category".
   * Keyword matches as a case-insensitive substring of the taxon name.
   */
  function parseKeywordRules(text) {
    const lines = (text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
    const rules = [];
    lines.forEach((line) => {
      const parts = line.includes('=>') ? line.split('=>') : line.split(',');
      if (parts.length < 2) return;
      const keyword = parts[0].trim();
      const category = parts.slice(1).join(',').trim();
      if (!keyword || !category) return;
      rules.push({ keyword: keyword.toLowerCase(), category });
    });
    return rules;
  }

  /**
   * @param {string} name
   * @param {number|string} taxid
   * @param {Map<string,string>} uploadedMap
   * @param {Array<{keyword:string, category:string}>} keywordRules
   * @returns {string|null}
   */
  function resolveTag(name, taxid, uploadedMap, keywordRules) {
    if (uploadedMap && uploadedMap.size > 0) {
      const byName = uploadedMap.get(String(name).toLowerCase());
      if (byName) return byName;
      const byTaxid = uploadedMap.get(String(taxid));
      if (byTaxid) return byTaxid;
    }
    if (keywordRules && keywordRules.length > 0) {
      const nameLower = String(name).toLowerCase();
      const rule = keywordRules.find((r) => nameLower.includes(r.keyword));
      if (rule) return rule.category;
    }
    return null;
  }

  const tagsExports = { parseTaxonTagList, parseKeywordRules, resolveTag };
  if (typeof module !== 'undefined' && module.exports) module.exports = tagsExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.tags = tagsExports;
  }
})();
