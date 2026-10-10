(function () {
  'use strict';

// Best-effort importer for taxonomy tables from tools without a native
// parser (BOLD/BIN exports, DADA2/mothur OTU tables, Kaiju, MetaPhlAn, ...).
//
// Every column gets a *role* (sample ID, count, a rank name, a lineage
// string, a rank taxid, a per-sample count column, or ignore). Roles are
// guessed from header names first and cell contents second, then shown to
// the user to confirm or change before anything loads. The confirmed
// mapping turns rows into {count, path} lineage rows and feeds the same
// tree builder the Lineage TSV and QIIME 2 readers use, so imported
// samples get the full sunburst/Sankey/comparison treatment.
//
// Layout is derived from the roles, not guessed separately:
//   - a `sample` column        -> long  (one row per sample x taxon/OTU)
//   - one or more `sample-count` -> wide (taxa as rows, a column per sample)
//   - otherwise                -> single (the whole file is one sample)

const { buildTreeFromLineageRows, syntheticTaxid, RANKS } =
  typeof module !== 'undefined' && module.exports ? require('./lineage-tsv') : window.ClannEDNA.lineageTsv;

const DELIMITERS = ['\t', ',', ';'];
const PROFILE_ROW_LIMIT = 500;

// Header words, compared against an underscore-tokenised lower-case header.
const RANK_SYNONYMS = {
  superkingdom: 'superkingdom',
  domain: 'superkingdom',
  kingdom: 'kingdom',
  phylum: 'phylum',
  division: 'phylum',
  class: 'class',
  order: 'order',
  family: 'family',
  genus: 'genus',
  species: 'species',
};
const SAMPLE_HEADERS = new Set([
  'sample', 'sample_id', 'sampleid', 'sample_name', 'samplename', 'sample_alias', 'barcode', 'library',
  'library_id', 'file', 'filename', 'run', 'run_accession',
]);
const COUNT_WORDS = new Set(['count', 'counts', 'reads', 'read', 'abundance', 'nreads', 'size', 'frequency', 'freq', 'total']);
const NOT_COUNT_WORDS = new Set([
  'length', 'len', 'pid', 'identity', 'ident', 'id', 'mean', 'avg', 'median', 'bp', 'overlap', 'score', 'evalue',
  'bitscore', 'pct', 'percent', 'percentage', 'taxid', 'replicates', 'replicate', 'confidence', 'boot', 'bootstrap',
  'prob', 'probability', 'gc', 'coverage', 'qual', 'quality', 'similarity', 'start', 'end', 'pos', 'position', 'n',
]);
const NOT_RANK_WORDS = new Set(['confidence', 'score', 'boot', 'bootstrap', 'prob', 'probability', 'pct', 'percent', 'support']);
const LINEAGE_WORDS = new Set(['taxonomy', 'lineage', 'classification', 'consensus_lineage', 'clade_name', 'taxon', 'tax']);
const NAME_HEADERS = new Set(['name', 'taxon', 'taxon_name', 'taxa', 'organism', 'scientific_name', 'species_name', 'tax_name']);

const UNRESOLVED_RE =
  /^(|na|n\/a|nan|null|none|-|\?|unassigned|unclassified|unknown|not assigned|no hit|no_hit|nohit|uncultured|cannot be assigned.*)$/i;
const RANK_PREFIX_RE = /^(sk|[dkpcofgst]|D_\d+)__(.*)$/i;
const PREFIX_RANK = { d: 'superkingdom', sk: 'superkingdom', k: 'kingdom', p: 'phylum', c: 'class', o: 'order', f: 'family', g: 'genus', s: 'species' };
// SILVA's D_0__..D_6__ levels, and the default for un-prefixed lineage
// strings (Kaiju's default `-l` set) — an assumption the UI states.
const POSITIONAL_RANKS = ['superkingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'];
const SKIP_UNPREFIXED = new Set(['root', 'cellular organisms']);

const ROLE_LABELS = {
  ignore: 'Ignore',
  sample: 'Sample ID',
  count: 'Read count',
  'sample-count': 'Counts for one sample (wide)',
  lineage: 'Lineage string',
};
for (const r of RANKS) {
  ROLE_LABELS[`rank:${r}`] = `Rank: ${r}`;
  ROLE_LABELS[`taxid:${r}`] = `Taxid: ${r}`;
}
const ROLE_OPTIONS = Object.keys(ROLE_LABELS);

// ---- Delimited text ------------------------------------------------

/**
 * Pick the delimiter that splits the first lines into the same (>1) number
 * of fields most consistently. Tab wins ties, then comma, then semicolon.
 * Returns null when nothing splits the text into at least two columns.
 */
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#')).slice(0, 20);
  if (lines.length === 0) return null;
  let best = null;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => splitRow(l, d).length);
    const freq = new Map();
    counts.forEach((c) => freq.set(c, (freq.get(c) || 0) + 1));
    let modeCount = 0;
    let modeFreq = 0;
    for (const [c, f] of freq) if (f > modeFreq || (f === modeFreq && c > modeCount)) [modeCount, modeFreq] = [c, f];
    if (modeCount < 2) continue;
    const consistency = modeFreq / lines.length;
    if (consistency < 0.8) continue;
    if (!best || consistency > best.consistency) best = { d, consistency };
  }
  return best ? best.d : null;
}

// Single-line split honouring double-quoted fields (used for sniffing).
function splitRow(line, delimiter) {
  return parseDelimited(line, delimiter)[0] || [];
}

/**
 * RFC 4180-ish parse: fields that start with a double quote run to the
 * matching quote (doubled quotes escape, newlines allowed inside). Blank
 * lines are dropped.
 */
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  const n = text.length;
  let atFieldStart = true;
  while (i < n) {
    const ch = text[i];
    if (atFieldStart && ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        field += text[i++];
      }
      atFieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      atFieldStart = true;
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field);
      if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
      row = [];
      field = '';
      atFieldStart = true;
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += ch;
    atFieldStart = false;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
  }
  return rows;
}

function isNumeric(value) {
  const v = (value || '').trim();
  return v !== '' && Number.isFinite(Number(v));
}

/**
 * Split text into {header, rows}. Leading `#` lines are comments, except
 * the last one when it has as many fields as the first data row — that is
 * a commented header (MetaPhlAn's `#clade_name ...`). A header row is
 * assumed unless every cell of row 1 is numeric, or row 1 has no text in a
 * column that is numeric everywhere else.
 */
function readTable(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  if (!d) return null;
  const all = parseDelimited(text, d);
  let start = 0;
  let commentHeader = null;
  while (start < all.length && (all[start][0] || '').startsWith('#')) {
    commentHeader = all[start];
    start++;
  }
  const body = all.slice(start);
  if (body.length === 0) return null;

  if (commentHeader && commentHeader.length === body[0].length && commentHeader.length >= 2) {
    const header = commentHeader.map((c, i) => (i === 0 ? c.replace(/^#+\s*/, '') : c).trim());
    return { delimiter: d, header, rows: body, hasHeader: true };
  }

  const first = body[0];
  const rest = body.slice(1, PROFILE_ROW_LIMIT + 1);
  let hasHeader = !first.every(isNumeric);
  if (hasHeader && rest.length > 0) {
    // A text cell sitting on top of an all-numeric column is a header label.
    const numericCols = first.map((_, c) => rest.every((r) => isNumeric(r[c])));
    hasHeader = numericCols.some(Boolean) ? first.some((cell, c) => numericCols[c] && !isNumeric(cell)) : true;
  }
  if (hasHeader) return { delimiter: d, header: first.map((c) => c.trim()), rows: body.slice(1), hasHeader: true };
  return { delimiter: d, header: first.map((_, i) => `Column ${i + 1}`), rows: body, hasHeader: false };
}

// ---- Role guessing ---------------------------------------------------

function headerTokens(header) {
  const norm = header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return { norm, tokens: norm.split('_').filter(Boolean) };
}

function profileColumns(header, rows) {
  const sample = rows.slice(0, PROFILE_ROW_LIMIT);
  return header.map((h, c) => {
    let numeric = 0;
    let integer = 0;
    let nonEmpty = 0;
    let lineageLike = 0;
    let withLetters = 0;
    let underscored = 0;
    let spaced = 0;
    const distinct = new Set();
    for (const r of sample) {
      const v = (r[c] || '').trim();
      if (v === '') continue;
      nonEmpty++;
      distinct.add(v);
      if (isNumeric(v)) {
        numeric++;
        if (/^-?\d+$/.test(v)) integer++;
      }
      if (/[A-Za-z]/.test(v)) {
        withLetters++;
        if (/[;|]/.test(v) || RANK_PREFIX_RE.test(v)) lineageLike++;
      }
      if (v.includes('_')) underscored++;
      if (v.includes(' ')) spaced++;
    }
    const denom = nonEmpty || 1;
    return {
      header: h,
      ...headerTokens(h),
      nonEmpty,
      numericFrac: numeric / denom,
      integerFrac: integer / denom,
      lineageFrac: lineageLike / denom,
      letterFrac: withLetters / denom,
      underscoreFrac: underscored / denom,
      spaceFrac: spaced / denom,
      distinct: distinct.size,
    };
  });
}

function rankScore(col) {
  if (col.nonEmpty === 0 || col.numericFrac > 0.5) return 0;
  if (col.tokens.some((t) => NOT_RANK_WORDS.has(t) || t === 'taxid')) return 0;
  if (RANK_SYNONYMS[col.norm]) return 3;
  if (col.tokens.length === 2 && col.tokens[1] === 'name' && RANK_SYNONYMS[col.tokens[0]]) return 2;
  if (col.tokens.some((t) => RANK_SYNONYMS[t])) return 1;
  return 0;
}

function rankOf(col) {
  if (RANK_SYNONYMS[col.norm]) return RANK_SYNONYMS[col.norm];
  const t = col.tokens.find((tok) => RANK_SYNONYMS[tok]);
  return t ? RANK_SYNONYMS[t] : null;
}

function countScore(col) {
  if (col.numericFrac < 0.9) return null;
  if (col.tokens.some((t) => NOT_COUNT_WORDS.has(t))) return -5;
  let score = 0;
  if (COUNT_WORDS.has(col.norm)) score += 4;
  else if (col.tokens.some((t) => COUNT_WORDS.has(t))) score += 3;
  if (col.integerFrac >= 0.9) score += 1;
  return score;
}

/**
 * Guess a role for every column. Returns a full mapping object (roles plus
 * clean-up options) that the UI shows for confirmation. Never throws; a
 * guess with no rank/lineage role is still returned so the user can fix it.
 */
function guessMapping(table) {
  const { header, rows } = table;
  const cols = profileColumns(header, rows);
  const roles = header.map(() => 'ignore');

  // Taxid columns: "<rank>_taxid" / "<rank> tax id".
  cols.forEach((col, c) => {
    const joined = col.tokens.join('');
    if (!/taxid$/.test(joined) && !(col.tokens.includes('tax') && col.tokens.includes('id'))) return;
    const rank = rankOf(col);
    if (rank && !roles.includes(`taxid:${rank}`)) roles[c] = `taxid:${rank}`;
  });

  // Lineage-string candidate: values that look like k__X|p__Y or a;b;c.
  let lineageCol = -1;
  let lineageScore = 0;
  cols.forEach((col, c) => {
    if (roles[c] !== 'ignore' || col.numericFrac > 0.5 || col.letterFrac < 0.5) return;
    const byHeader = LINEAGE_WORDS.has(col.norm) || col.tokens.some((t) => LINEAGE_WORDS.has(t));
    const score = col.lineageFrac >= 0.5 ? 2 + col.lineageFrac + (byHeader ? 1 : 0) : byHeader && col.lineageFrac > 0 ? 1 : 0;
    if (score > lineageScore) [lineageCol, lineageScore] = [c, score];
  });

  // Rank columns: best-scoring column per rank (exact header beats e.g.
  // BIN_Family). A strong lineage column wins over token-only rank guesses
  // such as MetaPhlAn's "additional_species".
  const bestPerRank = {};
  cols.forEach((col, c) => {
    if (roles[c] !== 'ignore') return;
    const score = rankScore(col);
    if (score === 0) return;
    const rank = rankOf(col);
    if (!bestPerRank[rank] || score > bestPerRank[rank].score) bestPerRank[rank] = { c, score };
  });
  const exactRanks = Object.values(bestPerRank).some((r) => r.score >= 2);
  if (lineageCol !== -1 && lineageScore >= 2 && !exactRanks) {
    roles[lineageCol] = 'lineage';
  } else {
    for (const [rank, { c }] of Object.entries(bestPerRank)) roles[c] = `rank:${rank}`;
    if (Object.keys(bestPerRank).length === 0 && lineageCol !== -1) roles[lineageCol] = 'lineage';
  }
  const hasRanks = roles.some((r) => r.startsWith('rank:'));

  // Sample column (long layout).
  const sampleCol = cols.findIndex((col, c) => roles[c] === 'ignore' && SAMPLE_HEADERS.has(col.norm));
  if (sampleCol !== -1) roles[sampleCol] = 'sample';

  // Name-only fallback: a single taxon-name column, mapped to species until
  // the user says otherwise.
  if (!hasRanks && !roles.includes('lineage')) {
    let nameCol = cols.findIndex((col, c) => roles[c] === 'ignore' && NAME_HEADERS.has(col.norm));
    if (nameCol === -1) nameCol = cols.findIndex((col, c) => roles[c] === 'ignore' && col.numericFrac < 0.3 && col.nonEmpty > 0);
    if (nameCol !== -1) roles[nameCol] = 'rank:species';
  }

  // Counts: a single count column, or (with no sample column) several
  // unlabelled numeric columns = one per sample.
  const scored = cols
    .map((col, c) => ({ c, score: roles[c] === 'ignore' ? countScore(col) : null }))
    .filter((s) => s.score !== null);
  const countLike = scored.filter((s) => s.score >= 3);
  const neutral = scored.filter((s) => s.score >= 0 && s.score < 3);
  if (sampleCol === -1 && countLike.length === 0 && neutral.length >= 2) {
    neutral.forEach(({ c }) => (roles[c] = 'sample-count'));
  } else {
    const best = scored.filter((s) => s.score >= 0).sort((a, b) => b.score - a.score || a.c - b.c)[0];
    if (best) roles[best.c] = 'count';
  }

  return { delimiter: table.delimiter, hasHeader: table.hasHeader, roles, options: guessOptions(cols, roles, rows) };
}

function guessOptions(cols, roles, rows) {
  const nameCols = roles.map((r, c) => (r.startsWith('rank:') ? cols[c] : null)).filter(Boolean);
  let underscoreHeavy = nameCols.some((col) => col.underscoreFrac >= 0.5 && col.spaceFrac < 0.1);
  const lineageCol = roles.indexOf('lineage');
  if (lineageCol !== -1) {
    // Judge on the names inside the lineage, after k__-style prefixes go.
    const names = rows
      .slice(0, PROFILE_ROW_LIMIT)
      .flatMap((r) => lineageSegments(r[lineageCol] || '').map((seg) => (RANK_PREFIX_RE.exec(seg) || [null, null, seg])[2]));
    const multiWord = names.filter((n) => /[_ ]/.test(n));
    underscoreHeavy = multiWord.length > 0 && multiWord.filter((n) => n.includes('_') && !n.includes(' ')).length / multiWord.length >= 0.5;
  }

  const speciesIdx = roles.indexOf('rank:species');
  const speciesEpithetOnly =
    speciesIdx !== -1 &&
    roles.includes('rank:genus') &&
    cols[speciesIdx].nonEmpty > 0 &&
    cols[speciesIdx].spaceFrac < 0.2 &&
    cols[speciesIdx].underscoreFrac < 0.2 &&
    rows.slice(0, PROFILE_ROW_LIMIT).every((r) => !/^[A-Z]/.test((r[speciesIdx] || '').trim()));

  const options = {
    underscoresToSpaces: underscoreHeavy,
    prefixGenusToSpecies: speciesEpithetOnly,
    cumulativeRows: false,
  };
  const lineageIdx = roles.indexOf('lineage');
  if (lineageIdx !== -1) options.cumulativeRows = looksCumulative(rows, roles, lineageIdx);
  return options;
}

// MetaPhlAn-style tables list every clade with its total, so a row whose
// lineage is a prefix of another row's lineage is an aggregate, not a leaf.
function looksCumulative(rows, roles, lineageIdx) {
  const sampleIdx = roles.indexOf('sample');
  const keys = rows.slice(0, PROFILE_ROW_LIMIT).map((r) => `${sampleIdx === -1 ? '' : r[sampleIdx]}\u0001${rawLineageKey(r[lineageIdx])}`);
  const internal = internalKeys(keys);
  const unique = new Set(keys);
  return unique.size > 0 && [...unique].filter((k) => internal.has(k)).length / unique.size >= 0.3;
}

// Every proper '|'-boundary prefix of any key — i.e. the keys that are
// aggregates of some more specific key.
function internalKeys(keys) {
  const prefixes = new Set();
  for (const k of keys) {
    let i = k.indexOf('|');
    while (i !== -1) {
      prefixes.add(k.slice(0, i));
      i = k.indexOf('|', i + 1);
    }
  }
  return prefixes;
}

function rawLineageKey(value) {
  return lineageSegments(value || '').map((s) => s.toLowerCase()).join('|');
}

function lineageSegments(value) {
  const sep = value.includes('|') ? '|' : ';';
  return value
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

// ---- Applying a mapping ---------------------------------------------

function cleanName(raw, options) {
  let name = (raw || '').trim();
  const m = RANK_PREFIX_RE.exec(name);
  if (m) name = m[2].trim();
  if (options.underscoresToSpaces) name = name.replace(/_+/g, ' ').trim();
  return UNRESOLVED_RE.test(name) ? '' : name;
}

/** Parse a lineage string into [{rank, name}], dropping unresolved levels. */
function parseLineageString(value, options) {
  const segments = lineageSegments(value || '');
  const path = [];
  let positional = 0;
  let droppedLevels = 0;
  for (const seg of segments) {
    const m = RANK_PREFIX_RE.exec(seg);
    let rank;
    if (m) {
      const prefix = m[1].toLowerCase();
      if (prefix === 't') continue; // MetaPhlAn strain level
      rank = prefix.startsWith('d_') && /^d_\d+$/.test(prefix) ? POSITIONAL_RANKS[Number(prefix.slice(2))] : PREFIX_RANK[prefix];
    } else {
      if (SKIP_UNPREFIXED.has(seg.toLowerCase())) continue;
      rank = POSITIONAL_RANKS[positional++];
    }
    if (!rank) {
      droppedLevels++;
      continue;
    }
    const name = cleanName(seg, options);
    if (name === '') continue;
    path.push({ rank, name });
  }
  path.sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
  return { path, droppedLevels };
}

/**
 * Check a mapping is usable. Returns a list of human-readable problems
 * (empty when it is fine to load).
 */
function validateMapping(mapping) {
  const errors = [];
  const roles = mapping.roles;
  const count = (role) => roles.filter((r) => r === role).length;
  if (!roles.some((r) => r.startsWith('rank:') || r === 'lineage')) {
    errors.push('Choose at least one rank column or a lineage-string column.');
  }
  for (const role of ['sample', 'count', 'lineage', ...RANKS.map((r) => `rank:${r}`), ...RANKS.map((r) => `taxid:${r}`)]) {
    if (count(role) > 1) errors.push(`Only one column can be "${ROLE_LABELS[role]}".`);
  }
  if (count('sample-count') > 0 && (count('sample') > 0 || count('count') > 0)) {
    errors.push('Per-sample count columns (wide layout) cannot be combined with a Sample ID or single Read count column.');
  }
  if (count('lineage') > 0 && roles.some((r) => r.startsWith('rank:'))) {
    errors.push('Use either a lineage-string column or separate rank columns, not both.');
  }
  return errors;
}

function layoutOf(mapping) {
  if (mapping.roles.includes('sample')) return 'long';
  if (mapping.roles.includes('sample-count')) return 'wide';
  return 'single';
}

/**
 * Turn table rows into per-sample lineage rows using a confirmed mapping.
 * Returns {samples: Map<sampleId, {rows, unclassified}>, stats}.
 */
function buildLineageRows(table, mapping, defaultSampleId) {
  const { header, rows } = table;
  const { roles } = mapping;
  const options = { ...mapping.options };
  const layout = layoutOf(mapping);
  const sampleIdx = roles.indexOf('sample');
  const countIdx = roles.indexOf('count');
  const lineageIdx = roles.indexOf('lineage');
  const rankCols = RANKS.map((rank) => ({ rank, c: roles.indexOf(`rank:${rank}`), t: roles.indexOf(`taxid:${rank}`) })).filter(
    (r) => r.c !== -1
  );
  const wideCols = roles.map((r, c) => (r === 'sample-count' ? c : -1)).filter((c) => c !== -1);

  const stats = {
    layout,
    dataRows: rows.length,
    skippedRows: 0,
    unclassifiedRows: 0,
    nonIntegerCounts: 0,
    droppedLineageLevels: 0,
    cumulativeRowsDropped: 0,
    deepestRank: Object.fromEntries(RANKS.map((r) => [r, 0])),
  };
  const samples = new Map();
  const bucket = (id) => {
    if (!samples.has(id)) samples.set(id, { rows: [], unclassified: 0 });
    return samples.get(id);
  };

  // Cumulative (MetaPhlAn-style) tables: drop rows that are a prefix of
  // another row in the same sample.
  let isInternal = () => false;
  if (lineageIdx !== -1 && options.cumulativeRows) {
    const sampleOf = (r) => (sampleIdx === -1 ? '' : (r[sampleIdx] || '').trim());
    const internal = internalKeys(rows.map((r) => `${sampleOf(r)}\u0001${rawLineageKey(r[lineageIdx])}`));
    isInternal = (r) => internal.has(`${sampleOf(r)}\u0001${rawLineageKey(r[lineageIdx])}`);
  }

  for (const r of rows) {
    if (r.length < 2) {
      stats.skippedRows++;
      continue;
    }
    if (isInternal(r)) {
      stats.cumulativeRowsDropped++;
      continue;
    }

    let path;
    if (lineageIdx !== -1) {
      const parsed = parseLineageString(r[lineageIdx], options);
      path = parsed.path;
      stats.droppedLineageLevels += parsed.droppedLevels;
    } else {
      path = [];
      for (const { rank, c } of rankCols) {
        let name = cleanName(r[c], options);
        if (name === '') continue;
        if (rank === 'species' && options.prefixGenusToSpecies) {
          const genus = path.find((p) => p.rank === 'genus');
          if (genus && !name.toLowerCase().startsWith(genus.name.toLowerCase() + ' ')) name = `${genus.name} ${name}`;
        }
        path.push({ rank, name });
      }
    }

    // Resolve taxids: a real one from a mapped taxid column, otherwise a
    // deterministic synthetic id from the lowercased ancestor path.
    const nameParts = [];
    const resolved = path.map(({ rank, name }) => {
      nameParts.push(name.toLowerCase());
      const tc = roles.indexOf(`taxid:${rank}`);
      const t = tc === -1 ? '' : (r[tc] || '').trim();
      if (/^\d+$/.test(t)) return { rank, name, taxid: Number(t), synthetic: false };
      return { rank, name, taxid: syntheticTaxid(nameParts.join('|')), synthetic: true };
    });

    const targets = [];
    if (layout === 'wide') {
      wideCols.forEach((c) => targets.push({ id: header[c], raw: r[c] }));
    } else {
      const id = layout === 'long' ? (r[sampleIdx] || '').trim() : defaultSampleId;
      if (!id) {
        stats.skippedRows++;
        continue;
      }
      targets.push({ id, raw: countIdx === -1 ? '1' : r[countIdx] });
    }

    let used = false;
    for (const { id, raw } of targets) {
      const count = Number((raw || '').trim());
      if (!Number.isFinite(count) || count <= 0) continue;
      if (!Number.isInteger(count)) stats.nonIntegerCounts++;
      used = true;
      if (resolved.length === 0) bucket(id).unclassified += count;
      else bucket(id).rows.push({ count, path: resolved });
    }
    if (!used) {
      stats.skippedRows++;
      continue;
    }
    if (resolved.length === 0) stats.unclassifiedRows++;
    else stats.deepestRank[resolved[resolved.length - 1].rank]++;
  }

  stats.sampleCount = samples.size;
  return { samples, stats };
}

/**
 * Load a confirmed mapping into `tree`. Returns the sample IDs created and
 * the build stats (also what the mapping panel previews).
 */
function importTable(text, mapping, tree, defaultSampleId) {
  const table = readTable(text, mapping.delimiter);
  if (!table) return { sampleIds: [], stats: null };
  const { samples, stats } = buildLineageRows(table, mapping, defaultSampleId);
  const sampleIds = [];
  for (const [id, { rows, unclassified }] of samples) {
    buildTreeFromLineageRows(rows, unclassified, tree, id);
    sampleIds.push(id);
  }
  return { sampleIds, stats };
}

/** Stable key for remembering a mapping across sessions: the header row. */
function headerSignature(table) {
  return `${table.delimiter === '\t' ? 'tab' : table.delimiter}:${table.header.map((h) => h.toLowerCase()).join('\u0001')}`;
}

/** Human-readable description of a mapping, for sample provenance. */
function describeMapping(table, mapping) {
  const parts = mapping.roles
    .map((role, c) => (role === 'ignore' ? null : `${table.header[c]} → ${ROLE_LABELS[role] || role}`))
    .filter(Boolean);
  const opts = Object.entries(mapping.options)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return `${layoutOf(mapping)} layout; ${parts.join('; ')}${opts.length ? `; options: ${opts.join(', ')}` : ''}`;
}

const tableImportExports = {
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
  describeMapping,
  ROLE_LABELS,
  ROLE_OPTIONS,
  POSITIONAL_RANKS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = tableImportExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.tableImport = tableImportExports;
}
})();
