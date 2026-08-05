// Taxon category tagging (brief: "Taxon category tagging by keyword match
// against taxon name, or by uploaded taxid/name list, for highlighting
// taxa of interest ... consistently across Krona, Sankey, and table
// views"). Two independent, combinable sources of tags:
//
//  - an uploaded two-column taxid/name -> category list (exact match)
//  - free-typed keyword rules ("keyword => category", word-boundary match)
//
// A taxon can only carry one category in this app (kept simple — v1 is
// about highlighting taxa of interest, not building a full multi-label
// tagging system); an exact uploaded match always wins over a keyword
// rule, and the first matching keyword rule wins among keyword rules.
//
// Tags are clade-aware: computeTreeTagMap() walks the taxonomy tree and
// propagates a match down to every descendant, so tagging "Chordata" as
// a host also tags "Homo sapiens" beneath it. A node's own match always
// overrides whatever category it inherited from an ancestor (the nearest
// match in the lineage wins), mirroring how the exclusion list prunes
// whole clades in filters.js's computeTreePruneMask.

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

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Whole-token match, not substring: "aves" must match a distinct word in
   * the name ("Cathartidae aves"), not just any occurrence ("Cavesia").
   * Tokens are split on anything that isn't a letter/digit, so this also
   * matches multi-word keywords like "homo sapiens".
   */
  function keywordMatches(nameLower, keywordLower) {
    if (!keywordLower) return false;
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(keywordLower)}(?:$|[^a-z0-9])`);
    return re.test(nameLower);
  }

  /**
   * One rule per line: "keyword => category" or "keyword, category".
   * Keyword matches as a case-insensitive whole-token match against the
   * taxon name (see keywordMatches).
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
      const rule = keywordRules.find((r) => keywordMatches(nameLower, r.keyword));
      if (rule) return rule.category;
    }
    return null;
  }

  /**
   * Clade-aware version of resolveTag: a single forward pass over the flat
   * taxonomy tree (parents appear before children — see taxonomy-tree.js),
   * propagating each node's resolved category down from its parent unless
   * the node itself matches, in which case its own match wins (nearest
   * match in the lineage takes precedence over a broader ancestor match).
   * This applies to both the uploaded list and keyword rules alike.
   *
   * Independent of any exclusion/abundance filtering — a node's tag is
   * computed the same way whether or not it's currently pruned from view,
   * so clearing a filter reveals already-correctly-tagged descendants
   * rather than requiring tags to be recomputed.
   *
   * @returns {{byTaxid: Map<number|string,string>, byName: Map<string,string>}}
   */
  function computeTreeTagMap(tree, uploadedMap, keywordRules) {
    const byTaxid = new Map();
    const byName = new Map();
    const hasUploaded = uploadedMap && uploadedMap.size > 0;
    const hasRules = keywordRules && keywordRules.length > 0;
    if (!hasUploaded && !hasRules) return { byTaxid, byName };

    const size = tree.size;
    const resolved = new Array(size).fill(null);
    for (let i = 0; i < size; i++) {
      const parentIdx = tree.parentIndex[i];
      const inherited = parentIdx !== -1 ? resolved[parentIdx] : null;
      const self = resolveTag(tree.name[i], tree.taxid[i], uploadedMap, keywordRules);
      const category = self || inherited;
      resolved[i] = category;
      if (category) {
        byTaxid.set(tree.taxid[i], category);
        byName.set(tree.name[i], category);
      }
    }
    return { byTaxid, byName };
  }

  const tagsExports = { parseTaxonTagList, parseKeywordRules, resolveTag, computeTreeTagMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = tagsExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.tags = tagsExports;
  }
})();
