(function () {
  'use strict';

  const { sniffFormat } = window.ClannEDNA.sniff;
  const { filesFromFileInput } = window.ClannEDNA.folderLoader;
  const { buildSample, guessSampleIdFromFilename } = window.ClannEDNA.sample;
  const { computeSampleSummary } = window.ClannEDNA.summary;
  const { RANK_ORDER, computeAvailableRanks, computeRankTable, computeGenericTable, sortRows, computeTopN } =
    window.ClannEDNA.rankTable;
  const { TaxonomyTree } = window.ClannEDNA.taxonomyTree;
  const { parseBreport } = window.ClannEDNA.breport;
  const { parseBracken } = window.ClannEDNA.bracken;
  const { parseGeneric } = window.ClannEDNA.generic;
  const { parseLineageTsv } = window.ClannEDNA.lineageTsv;
  const { captureProvenance } = window.ClannEDNA.provenance;
  const { buildHierarchyTree } = window.ClannEDNA.hierarchy;
  const { renderSunburstSVG } = window.ClannEDNA.sunburst;
  const { computeSankeyData, computeSankeyLayout, renderSankeySVG } = window.ClannEDNA.sankey;
  const { EXCLUDE, parseGroupNames, resolveSampleGroup, summarizeGroups } = window.ClannEDNA.groups;
  const { computeDiversity, computeDiversitySummary } = window.ClannEDNA.diversity;
  const { buildAbundanceMatrix, toPresenceAbsence, computeStackedComposition } = window.ClannEDNA.comparison;
  const { computeDistanceMatrix } = window.ClannEDNA.similarity;
  const { computePCoA } = window.ClannEDNA.ordination;
  const { renderHeatmapSVG, sequentialColor, binaryColor } = window.ClannEDNA.heatmap;
  const { renderStackedBarSVG } = window.ClannEDNA.stackedBar;
  const { renderOrdinationSVG } = window.ClannEDNA.ordinationPlot;
  const { parseExclusionList, matchesSearch, computeTreePruneMask } = window.ClannEDNA.filters;
  const { buildMicrobiomeAnalystExport } = window.ClannEDNA.microbiomeAnalystExport;
  const { parseSampleMetadata, matchSummary: metadataMatchSummary } = window.ClannEDNA.sampleMetadata;
  const { parseTaxonTagList, parseKeywordRules, resolveTag } = window.ClannEDNA.tags;
  const { createExportButtons } = window.ClannEDNA.svgExport;
  const { rankTableToCsv, abundanceMatrixToCsv, diversitySummaryToCsv, distanceMatrixToCsv } = window.ClannEDNA.csvExport;
  const { computeTaxonDetail } = window.ClannEDNA.taxonDetail;

  const BLAST_EXPLORER_URL = 'https://chriscreevey.github.io/clann-blast-explorer/';
  const parsers = { parseBreport, parseBracken, parseGeneric, parseLineageTsv, captureProvenance };

  const folderInput = document.getElementById('folder-input');
  const uploadBtn = document.getElementById('uploadBtn');
  const emptyOpenBtn = document.getElementById('emptyOpen');
  const tickList = document.getElementById('file-ticklist');
  const loadEmptyState = document.getElementById('load-empty-state');
  const loadBtn = document.getElementById('load-selected-btn');
  const explorerEl = document.getElementById('explorer');
  const emptyEl = document.getElementById('empty');
  const hTitle = document.getElementById('hTitle');
  const hMeta = document.getElementById('hMeta');

  // Compressed inputs (.gz/.zip) are accepted per the brief but in-browser
  // decompression isn't wired up yet — flagged rather than silently
  // dropped. Tracked for a later phase.
  const COMPRESSED_RE = /\.(gz|zip)$/i;

  function readFileHead(file, byteLimit = 8192) {
    return file.slice(0, byteLimit).text();
  }

  async function sniffFile(file) {
    if (COMPRESSED_RE.test(file.name)) {
      return {
        file,
        format: 'unknown',
        confidence: 'none',
        reason: 'compressed (.gz/.zip) — in-browser decompression not yet implemented',
      };
    }
    try {
      const head = await readFileHead(file);
      const result = sniffFormat(head);
      return { file, ...result };
    } catch (err) {
      return { file, format: 'unknown', confidence: 'none', reason: `could not read file: ${err.message}` };
    }
  }

  function formatLabel(result) {
    if (result.format === 'bracken') return '.bracken';
    if (result.format === 'breport') return '.breport';
    if (result.format === 'lineage-tsv') return 'Lineage TSV';
    if (result.format === 'qiime-taxonomy') return 'QIIME2 taxonomy.tsv';
    if (result.format === 'qiime-biom-tsv') return 'QIIME2 feature-table.tsv';
    if (result.format === 'generic') return result.confidence === 'unconfirmed' ? 'generic (unconfirmed)' : 'generic';
    return 'not recognised';
  }

  // ---- Tick-list ----------------------------------------------------

  let currentResults = []; // [{file, format, confidence, reason?, candidateNameColumn?, candidateAbundanceColumn?}]

  function buildTickListRow(result, index, usable) {
    const li = document.createElement('li');
    li.dataset.disabled = String(!usable);
    li.dataset.index = String(index);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = usable && result.confidence === 'high';
    checkbox.disabled = !usable;
    checkbox.className = 'row-checkbox';

    const isQiimeWholeRunFile = result.format === 'qiime-taxonomy' || result.format === 'qiime-biom-tsv';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sample-name-input';
    if (isQiimeWholeRunFile) {
      nameInput.value = '';
      nameInput.placeholder =
        result.format === 'qiime-biom-tsv' ? 'provides every sample in this run' : 'taxonomy lookup — no sample name needed';
      nameInput.disabled = true;
    } else {
      nameInput.value = guessSampleIdFromFilename(result.file.name);
      nameInput.title = 'Sample name — files sharing this name are merged into one sample';
      nameInput.disabled = !usable;
    }

    const filename = document.createElement('span');
    filename.textContent = result.file.name;
    filename.style.flex = '1';
    filename.className = 'filename';

    const label = document.createElement('span');
    label.className = 'format-label';
    label.textContent = formatLabel(result);

    li.appendChild(checkbox);
    li.appendChild(nameInput);
    li.appendChild(filename);
    li.appendChild(label);

    if (!usable || result.confidence === 'unconfirmed') {
      const reason = document.createElement('span');
      reason.className = 'reason';
      reason.textContent = result.reason || '';
      li.appendChild(reason);
    }

    if (result.format === 'generic' || (!usable && result.candidateNameColumn === undefined)) {
      const mappingRow = document.createElement('div');
      mappingRow.className = 'column-mapping';

      const nameColLabel = document.createElement('label');
      nameColLabel.textContent = 'name col ';
      const nameColInput = document.createElement('input');
      nameColInput.type = 'number';
      nameColInput.min = '0';
      nameColInput.className = 'name-col-input';
      nameColInput.value = String(result.candidateNameColumn ?? 0);
      nameColLabel.appendChild(nameColInput);

      const abColLabel = document.createElement('label');
      abColLabel.textContent = ' abundance col ';
      const abColInput = document.createElement('input');
      abColInput.type = 'number';
      abColInput.min = '0';
      abColInput.className = 'abundance-col-input';
      abColInput.value = String(result.candidateAbundanceColumn ?? 1);
      abColLabel.appendChild(abColInput);

      mappingRow.appendChild(nameColLabel);
      mappingRow.appendChild(abColLabel);

      if (!usable) {
        const forceBtn = document.createElement('button');
        forceBtn.type = 'button';
        forceBtn.textContent = 'Try as generic';
        forceBtn.addEventListener('click', () => {
          result.format = 'generic';
          result.confidence = 'unconfirmed';
          renderTickList(currentResults);
        });
        mappingRow.appendChild(forceBtn);
      }

      li.appendChild(mappingRow);
    }

    return li;
  }

  function renderTickList(results) {
    currentResults = results;
    tickList.innerHTML = '';
    tickList.style.display = results.length === 0 ? 'none' : '';
    loadEmptyState.style.display = results.length === 0 ? '' : 'none';
    loadBtn.style.display = results.some((r) => r.format !== 'unknown') ? '' : 'none';

    // Recognised files first, so the files you actually want to load
    // aren't buried among ones that didn't sniff as a known format —
    // those go in a collapsed section below instead of interleaved.
    const validIndices = [];
    const invalidIndices = [];
    results.forEach((r, i) => (r.format !== 'unknown' ? validIndices : invalidIndices).push(i));

    validIndices.forEach((i) => {
      tickList.appendChild(buildTickListRow(results[i], i, true));
    });

    if (invalidIndices.length > 0) {
      const wrapperLi = document.createElement('li');
      wrapperLi.className = 'invalid-files-wrapper';

      const details = document.createElement('details');
      details.className = 'invalid-files-section';
      const summary = document.createElement('summary');
      summary.textContent = `Other files not recognised (${invalidIndices.length})`;
      details.appendChild(summary);

      const invalidList = document.createElement('ul');
      invalidList.className = 'invalid-files-list';
      invalidIndices.forEach((i) => {
        invalidList.appendChild(buildTickListRow(results[i], i, false));
      });
      details.appendChild(invalidList);

      wrapperLi.appendChild(details);
      tickList.appendChild(wrapperLi);
    }
  }

  async function handleFiles(files) {
    const results = await Promise.all(files.map(sniffFile));
    renderTickList(results);
  }

  // A single "Choose files…" affordance appears in two places (the header,
  // always visible, and centered in the empty-state hero before anything is
  // loaded) — both just open the plain multi-file picker below, which
  // behaves identically across every browser (no directory-picker feature
  // detection/fallback to keep in sync — see folder-loader.js).
  function chooseFiles() {
    folderInput.click();
  }

  folderInput.addEventListener('change', async (event) => {
    const files = filesFromFileInput(event.target.files);
    await handleFiles(files);
  });

  uploadBtn.addEventListener('click', chooseFiles);
  emptyOpenBtn.addEventListener('click', chooseFiles);

  // ---- Loading selected files into samples --------------------------

  const run = { tree: new TaxonomyTree(), samples: new Map() };
  let activeSampleId = null;
  let groupNamesText = '';

  // Global filters (PLAN.md Phase 7) — applied inside computeRankTable, so
  // every view that reads through it (single-sample table, Top-N chart,
  // and the whole multi-sample comparison section) recalculates
  // consistently. See src/model/filters.js for the exclusion/threshold
  // semantics. globalSearchText is separate and non-destructive: it only
  // highlights matches, it never removes rows (the per-sample table's own
  // search box, further down, still does that local filtering).
  let exclusionListText = '';
  let minAbundanceMode = 'pct';
  let minAbundanceValue = 0;
  let globalSearchText = '';

  // Set by clicking a taxon in the Multi-sample comparison section's
  // stacked-bar legend — highlights that one taxon consistently across
  // the comparison's stacked bar, abundance/presence heatmaps, and
  // small-multiples sunburst. A separate state from globalSearchText
  // (rather than writing into the search box) since there's no visible
  // search field on this card to reflect it back into, and search vs. a
  // one-off "which colour is this" click are different intents. Click the
  // same entry again (or a different one) to swap/clear it.
  let legendHighlightName = null;

  function currentFilters() {
    return {
      exclusionTerms: parseExclusionList(exclusionListText),
      minAbundance: { mode: minAbundanceMode, value: minAbundanceValue },
    };
  }

  function comparisonHighlightMatch(name, taxid) {
    return matchesSearch(name, taxid, globalSearchText) || (legendHighlightName !== null && name === legendHighlightName);
  }

  // Sample metadata (PLAN.md Phase 8) — a joined CSV/TSV keyed by sample
  // ID. Purely a display/labeling concern like groups/filters: it never
  // touches parsed sample data. Manual group assignment always takes
  // precedence over pre-populating from a metadata column (sample.group
  // Source tracks which one last set a sample's group).
  let sampleMetadataFile = null; // {idColumnName, fieldNames, rowsById}
  let metadataUploadError = '';
  let groupPrepopulateColumn = '';

  // Taxon category tagging (PLAN.md Phase 8) — a category is either an
  // exact match from an uploaded taxid/name list or a substring match
  // from a typed keyword rule (src/model/tags.js resolves precedence).
  // Applied consistently across the rank table, Top-N chart, sunburst,
  // Sankey, and comparison heatmaps/stacked bar, alongside (not instead
  // of) the Phase 7 search highlight.
  let taxonTagListText = '';
  let keywordRulesText = '';

  function currentTagResolver() {
    const uploadedMap = parseTaxonTagList(taxonTagListText);
    const keywordRules = parseKeywordRules(keywordRulesText);
    if (uploadedMap.size === 0 && keywordRules.length === 0) return null;
    return (name, taxid) => resolveTag(name, taxid, uploadedMap, keywordRules);
  }

  function colorForCategory(category) {
    let hash = 0;
    for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
    return `hsl(${(hash % 360)}, 70%, 45%)`;
  }

  async function loadSelected() {
    const rows = Array.from(tickList.querySelectorAll('li'));
    const grouped = new Map(); // sampleName -> {breport?, bracken?, generic?}
    let qiimeTaxonomyFile = null;
    let qiimeBiomTsvFile = null;

    for (const li of rows) {
      const checkbox = li.querySelector('.row-checkbox');
      if (!checkbox || !checkbox.checked) continue;
      const index = Number(li.dataset.index);
      const result = currentResults[index];

      if (result.format === 'qiime-taxonomy') {
        qiimeTaxonomyFile = { text: await result.file.text(), filename: result.file.name };
        continue;
      }
      if (result.format === 'qiime-biom-tsv') {
        qiimeBiomTsvFile = { text: await result.file.text(), filename: result.file.name };
        continue;
      }

      const sampleName = li.querySelector('.sample-name-input').value.trim();
      if (!sampleName) continue;

      if (!grouped.has(sampleName)) grouped.set(sampleName, {});
      const bucket = grouped.get(sampleName);
      const text = await result.file.text();

      if (result.format === 'breport') {
        bucket.breport = { text, filename: result.file.name };
      } else if (result.format === 'bracken') {
        bucket.bracken = { text, filename: result.file.name };
      } else if (result.format === 'lineage-tsv') {
        bucket.lineageTsv = { text, filename: result.file.name, columnIndex: result.columnIndex };
      } else if (result.format === 'generic') {
        const nameColumn = Number(li.querySelector('.name-col-input').value);
        const abundanceColumn = Number(li.querySelector('.abundance-col-input').value);
        bucket.generic = { text, filename: result.file.name, mapping: { nameColumn, abundanceColumn } };
      }
    }

    if (Boolean(qiimeTaxonomyFile) !== Boolean(qiimeBiomTsvFile)) {
      alert(
        'A QIIME2 run needs both the taxonomy.tsv and the feature-table.tsv ticked together — tick the other one too before loading.'
      );
      return;
    }

    if (grouped.size === 0 && !qiimeTaxonomyFile) {
      alert('Tick at least one recognised file, and give it a sample name, before loading.');
      return;
    }

    let firstQiimeSampleId = null;
    if (qiimeTaxonomyFile && qiimeBiomTsvFile) {
      const { parseQiimeTaxonomy, buildQiimeSamples } = window.ClannEDNA.qiime;
      const taxonomyByFeatureId = parseQiimeTaxonomy(qiimeTaxonomyFile.text);
      const { sampleIds } = buildQiimeSamples(qiimeBiomTsvFile.text, taxonomyByFeatureId, run.tree);
      for (const sampleId of sampleIds) {
        run.samples.set(sampleId, {
          id: sampleId,
          displayName: sampleId,
          kind: 'tree',
          hasBreport: false,
          hasBracken: false,
          hasLineageTsv: false,
          provenance: null,
          genericRows: null,
          sourceFiles: [qiimeTaxonomyFile.filename, qiimeBiomTsvFile.filename],
          group: null,
          groupSource: null,
          metadata: null,
        });
      }
      firstQiimeSampleId = sampleIds[0] || null;
    }

    for (const [sampleId, inputs] of grouped) {
      const sample = buildSample(sampleId, inputs, run.tree, parsers);
      run.samples.set(sampleId, sample);
    }

    activeSampleId =
      activeSampleId && run.samples.has(activeSampleId)
        ? activeSampleId
        : grouped.keys().next().value || firstQiimeSampleId;

    // Once a run is loaded, the tick-list has done its job — leaving it
    // sitting there under "Choose files…" is just clutter, so collapse
    // it down to a one-line summary. "Choose files…" (header or hero)
    // still starts a fresh pick at any time.
    tickList.innerHTML = '';
    tickList.style.display = 'none';
    loadBtn.style.display = 'none';
    loadEmptyState.style.display = '';
    loadEmptyState.textContent = `${run.samples.size} sample${run.samples.size === 1 ? '' : 's'} loaded. Choose files above to load more.`;

    renderResults();
  }

  loadBtn.addEventListener('click', () => {
    loadSelected().catch((err) => {
      console.error(err);
      alert(`Failed to load: ${err.message}`);
    });
  });

  // ---- Results panel --------------------------------------------------

  let currentRank = null;
  let currentSearch = '';
  let currentSort = { column: 'cladeReads', direction: 'desc' };
  const expandedTaxids = new Set(); // rank-table rows with their detail card open
  let topN = 15;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    });
    children.forEach((c) => node.appendChild(c));
    return node;
  }

  // A big, non-card divider distinguishing "cross-sample" content (the
  // Overview dashboard + Multi-sample comparison) from "single active
  // sample" content below it — both used to just be a flat run of equally
  // small .card <h3> headers, so where one group ended and the other
  // began wasn't obvious at a glance.
  function renderSectionBanner(title, subtitle) {
    const banner = el('div', { className: 'section-banner' });
    banner.appendChild(el('div', { className: 'section-banner-title', text: title }));
    if (subtitle) banner.appendChild(el('div', { className: 'section-banner-subtitle', text: subtitle }));
    return banner;
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- Sample groups (PLAN.md Phase 4) --------------------------------
  //
  // Group assignment is a display/analysis-layer setting only — it never
  // touches run.tree or the parsed sample data, so retyping the group list
  // or reassigning a sample re-renders instantly with no re-parse. Every
  // later group-aware view (Phase 5+) should read assignments via
  // summarizeGroups(run.samples, currentGroupNames()) rather than filtering
  // samples itself, so it stays in sync with this panel automatically.

  function currentGroupNames() {
    return parseGroupNames(groupNamesText);
  }

  function sampleLabelWithGroup(sample) {
    if (sample.group === EXCLUDE) return `${sample.id} (excluded)`;
    if (sample.group) return `${sample.id} (${sample.group})`;
    return sample.id;
  }

  function renderGroupsSection() {
    if (run.samples.size < 2) {
      // brief: no grouping UI for a single sample — still show a hint
      // rather than an empty collapsible section.
      return el('div', {
        className: 'hint',
        text: run.samples.size === 0 ? 'Load a run to assign sample groups.' : 'Load a second sample to assign groups.',
      });
    }

    const section = el('div', { className: 'groups-section' });
    section.appendChild(
      el('p', {
        className: 'hint',
        text: 'Type group names separated by commas, then assign each sample to one below. Excluded samples stay loaded but are left out of every calculation and view.',
      })
    );

    const textInput = el('input', {
      id: 'group-name-text-input',
      type: 'text',
      placeholder: 'e.g. Soil, Vegetation, Water',
      value: groupNamesText,
    });
    textInput.addEventListener('input', () => {
      groupNamesText = textInput.value;
      const cursorPos = textInput.selectionStart;
      const newGroupNames = currentGroupNames();
      // Normalize every sample's stored assignment against the new list
      // immediately, so a group that got retyped away doesn't leave a
      // stale value sitting on the sample object for some later reader to
      // forget to resolve (see resolveSampleGroup).
      for (const sample of run.samples.values()) {
        sample.group = resolveSampleGroup(sample.group, newGroupNames);
      }
      renderResults();
      const restored = document.getElementById('group-name-text-input');
      if (restored) {
        restored.focus();
        restored.setSelectionRange(cursorPos, cursorPos);
      }
    });
    section.appendChild(el('div', { className: 'group-name-input-row' }, [textInput]));

    const groupNames = currentGroupNames();
    const list = el('ul', { className: 'sample-group-list scroll-panel' });
    for (const sample of run.samples.values()) {
      const li = el('li', { className: 'sample-group-row' });
      const nameLabel = sample.metadata ? `${sample.id} 🏷` : sample.id;
      const nameSpan = el('span', { className: 'sample-group-name', text: nameLabel });
      if (sample.metadata) {
        nameSpan.title = Object.entries(sample.metadata)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
      }
      li.appendChild(nameSpan);

      const select = el('select');
      select.appendChild(el('option', { value: '', text: '— unassigned —' }));
      groupNames.forEach((g) => select.appendChild(el('option', { value: g, text: g })));
      select.appendChild(el('option', { value: EXCLUDE, text: EXCLUDE }));
      select.value = sample.group && (groupNames.includes(sample.group) || sample.group === EXCLUDE) ? sample.group : '';

      select.addEventListener('change', () => {
        sample.group = select.value || null;
        sample.groupSource = 'manual'; // manual assignment always wins over metadata pre-population
        renderResults();
      });
      li.appendChild(select);
      list.appendChild(li);
    }
    section.appendChild(list);

    const summary = summarizeGroups(run.samples, groupNames);
    const summaryParts = [];
    groupNames.forEach((g) => {
      const count = summary.byGroup.get(g).length;
      if (count > 0) summaryParts.push(`${g}: ${count}`);
    });
    if (summary.unassigned.length > 0) summaryParts.push(`unassigned: ${summary.unassigned.length}`);
    if (summary.excluded.length > 0) summaryParts.push(`excluded: ${summary.excluded.length}`);
    section.appendChild(el('p', { className: 'row-count', text: summaryParts.join(' · ') }));

    return section;
  }

  // ---- Sample metadata join + group pre-population (PLAN.md Phase 8) --

  function renderSampleMetadataSection() {
    if (run.samples.size === 0) {
      return el('div', { className: 'hint', text: 'Load a run to join sample metadata.' });
    }
    const container = el('div', { className: 'sample-metadata-section' });
    container.appendChild(
      el('p', {
        className: 'hint',
        text: 'Upload a CSV/TSV: first column is the sample/barcode ID, any further columns are metadata fields. Matches are joined by exact ID — a manual group assignment in Sample groups always takes precedence over pre-populating from a column here.',
      })
    );
    {
      const exampleHint = el('p', { className: 'hint' });
      exampleHint.appendChild(document.createTextNode('Not sure of the format? See '));
      exampleHint.appendChild(el('a', { href: 'examples/sample-metadata.tsv', target: '_blank', rel: 'noopener', text: 'examples/sample-metadata.tsv' }));
      exampleHint.appendChild(document.createTextNode('.'));
      container.appendChild(exampleHint);
    }

    // No `accept` filter: this app identifies files by content, not
    // extension (see the folder-loader.js note) — a Galaxy-exported
    // CSV/TSV can easily land with a non-standard extension (e.g.
    // ".tabular", or none at all), and an accept filter would silently
    // hide it from the picker.
    const fileInput = el('input', { type: 'file', style: 'display:none' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        sampleMetadataFile = parseSampleMetadata(text);
        metadataUploadError = '';
        for (const sample of run.samples.values()) {
          sample.metadata = sampleMetadataFile.rowsById.get(sample.id) || null;
        }
      } catch (err) {
        metadataUploadError = `Could not read ${file.name}: ${err.message}`;
        sampleMetadataFile = null;
      }
      renderResults();
    });
    const uploadBtnEl = el('button', { className: 'act', type: 'button', text: 'Upload sample metadata…' });
    uploadBtnEl.addEventListener('click', () => fileInput.click());
    container.appendChild(uploadBtnEl);
    container.appendChild(fileInput);

    if (metadataUploadError) {
      container.appendChild(el('p', { className: 'export-warnings', text: metadataUploadError }));
    }

    if (sampleMetadataFile && sampleMetadataFile.fieldNames.length > 0) {
      const summary = metadataMatchSummary([...run.samples.keys()], sampleMetadataFile);
      const parts = [`${summary.matched.length} of ${run.samples.size} loaded samples matched`];
      if (summary.unmatchedSamples.length > 0) parts.push(`no metadata row for: ${summary.unmatchedSamples.join(', ')}`);
      if (summary.unmatchedRows.length > 0) parts.push(`unused metadata rows: ${summary.unmatchedRows.join(', ')}`);
      container.appendChild(el('p', { className: 'row-count', text: parts.join(' · ') }));

      const prepopRow = el('div', { className: 'topn-controls' });
      const columnSelect = el('select');
      sampleMetadataFile.fieldNames.forEach((field) => {
        const opt = el('option', { value: field, text: field });
        opt.selected = field === groupPrepopulateColumn;
        columnSelect.appendChild(opt);
      });
      const applyBtn = el('button', { className: 'act', type: 'button', text: 'Pre-populate groups from this column' });
      applyBtn.addEventListener('click', () => {
        groupPrepopulateColumn = columnSelect.value;
        const values = new Set();
        for (const sample of run.samples.values()) {
          if (sample.groupSource === 'manual') continue; // never overwrite a manual choice
          const row = sampleMetadataFile.rowsById.get(sample.id);
          const value = row ? row[groupPrepopulateColumn] : '';
          if (!value) continue;
          sample.group = value;
          sample.groupSource = 'metadata';
          values.add(value);
        }
        // Make sure every newly-introduced group name is selectable in the
        // dropdowns above, without clobbering whatever the student already typed.
        const existing = currentGroupNames();
        const merged = [...new Set([...existing, ...values])];
        groupNamesText = merged.join(', ');
        renderResults();
      });
      prepopRow.appendChild(el('label', { text: 'Column: ' }));
      prepopRow.appendChild(columnSelect);
      prepopRow.appendChild(applyBtn);
      container.appendChild(prepopRow);
    }

    return container;
  }

  // ---- Global filters + search (PLAN.md Phase 7) -----------------------

  function focusPreservingInput(input, id, onCommit) {
    input.addEventListener('input', () => {
      const cursorPos = input.selectionStart;
      onCommit(input.value);
      renderResults();
      const restored = document.getElementById(id);
      if (restored) {
        restored.focus();
        restored.setSelectionRange(cursorPos, cursorPos);
      }
    });
  }

  function renderFiltersSection() {
    if (run.samples.size === 0) {
      return el('div', { className: 'hint', text: 'Load a run to filter and search.' });
    }
    const section = el('div', { className: 'filters-section' });

    // Host/contaminant exclusion list
    section.appendChild(
      el('p', {
        className: 'hint',
        text: 'Exclude known host/contaminant taxa (exact name or taxid, comma or newline separated) — removed from every view and every calculation, with the rest renormalized to 100%. Click "Apply exclusions" to recalculate.',
      })
    );
    const exclusionRow = el('div', { className: 'filter-exclusion-row' });
    const exclusionInput = el('textarea', {
      id: 'exclusion-list-input',
      rows: '2',
      placeholder: 'e.g. Homo sapiens, Bos taurus',
    });
    exclusionInput.value = exclusionListText;
    // Deliberately not auto-applied on every keystroke: excluding a taxon
    // recomputes and redraws every chart, which is disruptive while the
    // user is still mid-edit. Committing happens on explicit Apply instead.
    const applyExclusionsBtn = el('button', { className: 'act', type: 'button', text: 'Apply exclusions' });
    applyExclusionsBtn.disabled = true;
    exclusionInput.addEventListener('input', () => {
      applyExclusionsBtn.disabled = exclusionInput.value === exclusionListText;
    });
    const commitExclusions = () => {
      const cursorPos = exclusionInput.selectionStart;
      exclusionListText = exclusionInput.value;
      renderResults();
      const restored = document.getElementById('exclusion-list-input');
      if (restored) {
        restored.focus();
        restored.setSelectionRange(cursorPos, cursorPos);
      }
    };
    applyExclusionsBtn.addEventListener('click', commitExclusions);
    exclusionInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        commitExclusions();
      }
    });
    exclusionRow.appendChild(exclusionInput);
    exclusionRow.appendChild(applyExclusionsBtn);
    section.appendChild(exclusionRow);

    // Minimum abundance threshold
    const thresholdRow = el('div', { className: 'filter-threshold-row' });
    thresholdRow.appendChild(el('label', { text: 'Minimum abundance: ' }));
    const modeSelect = el('select');
    [
      ['pct', '%'],
      ['reads', 'reads'],
    ].forEach(([value, label]) => {
      const opt = el('option', { value, text: label });
      opt.selected = value === minAbundanceMode;
      modeSelect.appendChild(opt);
    });
    modeSelect.addEventListener('change', () => {
      minAbundanceMode = modeSelect.value;
      renderResults();
    });
    const valueInput = el('input', { type: 'number', min: '0', step: '0.1', value: String(minAbundanceValue) });
    valueInput.addEventListener('change', () => {
      minAbundanceValue = Math.max(0, Number(valueInput.value) || 0);
      renderResults();
    });
    thresholdRow.appendChild(valueInput);
    thresholdRow.appendChild(modeSelect);
    section.appendChild(thresholdRow);

    // Global taxon search — highlights, never filters, across every open view.
    const searchRow = el('div', { className: 'search-row' });
    const searchInput = el('input', {
      id: 'global-search-input',
      type: 'search',
      placeholder: 'Highlight a taxon by name or taxid across every view…',
    });
    searchInput.value = globalSearchText;
    focusPreservingInput(searchInput, 'global-search-input', (v) => {
      globalSearchText = v;
    });
    searchRow.appendChild(searchInput);
    section.appendChild(searchRow);

    // Resets every control in this section, not just the threshold — the
    // exclusion list and search box are easy to forget you've left set
    // once you've moved on to something else.
    const resetBtn = el('button', { className: 'act warn', type: 'button', text: 'Reset filters & search' });
    resetBtn.addEventListener('click', () => {
      exclusionListText = '';
      minAbundanceValue = 0;
      minAbundanceMode = 'pct';
      globalSearchText = '';
      renderResults();
    });
    section.appendChild(el('div', { className: 'diagram-export-row' }, [resetBtn]));

    return section;
  }

  // ---- Taxon category tagging (PLAN.md Phase 8) ------------------------

  function renderTaxonTagsSection() {
    if (run.samples.size === 0) {
      return el('div', { className: 'hint', text: 'Load a run to tag taxa by category.' });
    }
    const section = el('div', { className: 'tags-section' });
    section.appendChild(
      el('p', {
        className: 'hint',
        text: 'Highlight taxa of interest (pathogens, indicator species, invasive species) consistently across the rank table, Top-N chart, sunburst, Sankey, and comparison heatmaps.',
      })
    );

    // No `accept` filter: this app identifies files by content, not
    // extension (see the folder-loader.js note) — a Galaxy-exported
    // CSV/TSV can easily land with a non-standard extension (e.g.
    // ".tabular", or none at all), and an accept filter would silently
    // hide it from the picker.
    const fileInput = el('input', { type: 'file', style: 'display:none' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      taxonTagListText = await file.text();
      renderResults();
    });
    const uploadTagListBtn = el('button', { className: 'act', type: 'button', text: 'Upload tag list (taxon/taxid, category)…' });
    uploadTagListBtn.addEventListener('click', () => fileInput.click());
    section.appendChild(uploadTagListBtn);
    section.appendChild(fileInput);

    {
      const exampleHint = el('p', { className: 'hint' });
      exampleHint.appendChild(document.createTextNode('Not sure of the format? See '));
      exampleHint.appendChild(el('a', { href: 'examples/taxon-category-tags.tsv', target: '_blank', rel: 'noopener', text: 'examples/taxon-category-tags.tsv' }));
      exampleHint.appendChild(document.createTextNode(' (no header row — each line is taxon/taxid, category).'));
      section.appendChild(exampleHint);
    }

    section.appendChild(el('p', { className: 'hint', text: 'Or type keyword rules, one per line: keyword => category' }));
    const keywordInput = el('textarea', {
      id: 'keyword-rules-input',
      rows: '2',
      placeholder: 'e.g. coli => Pathogen\nBos => Livestock contaminant',
    });
    keywordInput.value = keywordRulesText;
    focusPreservingInput(keywordInput, 'keyword-rules-input', (v) => {
      keywordRulesText = v;
    });
    section.appendChild(keywordInput);

    const tagResolver = currentTagResolver();
    if (tagResolver) {
      const uploadedMap = parseTaxonTagList(taxonTagListText);
      const rules = parseKeywordRules(keywordRulesText);
      const categories = new Set([...uploadedMap.values(), ...rules.map((r) => r.category)]);
      const legend = el('div', { className: 'tag-legend' });
      categories.forEach((cat) => {
        const chip = el('span', { className: 'tag-chip', text: cat });
        chip.style.borderColor = colorForCategory(cat);
        legend.appendChild(chip);
      });
      section.appendChild(legend);
    }

    return section;
  }

  function renderSampleSelector() {
    const ids = [...run.samples.keys()];
    if (ids.length <= 1) return null;
    const select = el('select', { id: 'sample-selector' });
    ids.forEach((id) => {
      const sample = run.samples.get(id);
      const opt = el('option', { value: id, text: sampleLabelWithGroup(sample) });
      if (id === activeSampleId) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      activeSampleId = select.value;
      currentRank = null;
      renderResults();
    });
    return el('div', { className: 'sample-selector-row' }, [el('label', { text: 'Sample: ' }), select]);
  }

  function renderSummaryCard(sample) {
    const card = el('div', { className: 'card summary-card' });
    card.appendChild(el('h3', { text: sample.displayName }));

    if (sample.kind === 'generic') {
      card.appendChild(
        el('p', { text: `Generic format — ${sample.genericRows.length} rows, no taxonomic hierarchy available.` })
      );
      return card;
    }

    const summary = computeSampleSummary(run.tree, sample.id, { filters: currentFilters() });
    const stats = el('dl', { className: 'stat-grid' });
    const addStat = (label, value) => {
      stats.appendChild(el('dt', { text: label }));
      stats.appendChild(el('dd', { text: value }));
    };
    addStat('Total reads', summary.totalReads.toLocaleString());
    addStat('Classified', `${summary.classifiedReads.toLocaleString()} (${summary.classifiedPct.toFixed(2)}%)`);
    addStat('Unclassified', summary.unclassifiedReads.toLocaleString());
    if (summary.excludedReads > 0) {
      addStat('Excluded (filters)', summary.excludedReads.toLocaleString());
    }
    if (summary.hasKrakenBreakdown) {
      addStat('Raw Kraken-assigned (species)', summary.rawAssignedReads.toLocaleString());
      addStat('Bracken-re-estimated (species)', summary.reEstimatedReads.toLocaleString());
    }
    card.appendChild(stats);

    if (sample.provenance) {
      const details = el('details', { className: 'provenance-details' });
      details.appendChild(el('summary', { text: 'Provenance metadata' }));
      const dl = el('dl', { className: 'stat-grid' });
      Object.entries(sample.provenance).forEach(([k, v]) => {
        dl.appendChild(el('dt', { text: k }));
        dl.appendChild(el('dd', { text: v }));
      });
      details.appendChild(dl);
      card.appendChild(details);
    }

    return card;
  }

  function getTableRows(sample) {
    if (sample.kind === 'generic') {
      return computeGenericTable(sample.genericRows, currentSearch);
    }
    if (!currentRank) return [];
    return computeRankTable(run.tree, sample.id, currentRank, currentSearch, currentFilters());
  }

  function renderRankControls(sample) {
    if (sample.kind === 'generic') return null;
    const ranks = computeAvailableRanks(run.tree, sample.id);
    if (!currentRank || !ranks.includes(currentRank)) currentRank = ranks[ranks.length - 1] || null;

    const select = el('select', { id: 'rank-selector' });
    ranks.forEach((r) => {
      const opt = el('option', { value: r, text: r });
      if (r === currentRank) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      currentRank = select.value;
      renderResults();
    });

    return el('div', { className: 'rank-controls' }, [el('label', { text: 'Rank: ' }), select]);
  }

  function renderSearchBox() {
    const input = el('input', { type: 'search', placeholder: 'Search taxon name or taxid…', value: currentSearch });
    input.addEventListener('input', () => {
      currentSearch = input.value;
      renderTableAndChart();
    });
    return el('div', { className: 'search-row' }, [input]);
  }

  const TABLE_COLUMNS = [
    { key: 'name', label: 'Name' },
    { key: 'cladeReads', label: 'Reads' },
    { key: 'pctOfTotal', label: '% of total' },
  ];

  // ---- Per-taxon detail card + BLAST Explorer cross-link (Phase 9) -----
  //
  // "taxa flagged as unexpected or worth verifying here could have
  // representative reads pulled and BLASTed in Clann BLAST Explorer to
  // confirm identification" — this app has no raw reads (only
  // classification results), so the link is necessarily a jumping-off
  // point to the other tool rather than a pre-filled query.
  function renderTaxonDetailCard(taxid, tagResolver) {
    const detail = computeTaxonDetail(run.tree, taxid, [...run.samples.keys()]);
    const card = el('div', { className: 'taxon-detail-card' });
    if (!detail) {
      card.appendChild(el('p', { className: 'empty-state', text: 'No detail available for this taxon.' }));
      return card;
    }

    const category = tagResolver && tagResolver(detail.name, detail.taxid);
    const titleRow = el('div', { className: 'taxon-detail-title' });
    titleRow.appendChild(el('strong', { text: `${detail.name} (taxid ${detail.taxid}, rank ${detail.rank})` }));
    if (category) {
      const badge = el('span', { className: 'tag-badge', text: category });
      badge.style.borderColor = colorForCategory(category);
      titleRow.appendChild(badge);
    }
    card.appendChild(titleRow);

    card.appendChild(el('p', { className: 'taxon-detail-lineage', text: detail.lineage.map((n) => n.name).join(' › ') }));

    const sampleTable = el('table', { className: 'rank-table' });
    sampleTable.appendChild(
      el('thead', {}, [el('tr', {}, ['Sample', 'Group', 'Reads', '% of total'].map((h) => el('th', { text: h })))])
    );
    const sampleBody = el('tbody');
    detail.perSample.forEach((s) => {
      const sample = run.samples.get(s.sampleId);
      sampleBody.appendChild(
        el('tr', {}, [
          el('td', { text: s.sampleId }),
          el('td', { text: (sample && sample.group) || '' }),
          el('td', { text: s.cladeReads.toLocaleString() }),
          el('td', { text: `${s.pctOfTotal.toFixed(3)}%` }),
        ])
      );
    });
    sampleTable.appendChild(sampleBody);
    card.appendChild(el('div', { className: 'table-wrap' }, [sampleTable]));

    const blastLink = el('a', {
      href: BLAST_EXPLORER_URL,
      target: '_blank',
      rel: 'noopener',
      text: 'Verify in Clann BLAST Explorer ↗',
    });
    card.appendChild(
      el('p', { className: 'hint' }, [
        document.createTextNode('This tool has no raw reads to pass along — open '),
        blastLink,
        document.createTextNode(' and BLAST a representative read yourself to confirm this identification.'),
      ])
    );

    return card;
  }

  function renderTable(rows) {
    const table = el('table', { className: 'rank-table' });
    const thead = el('thead');
    const headRow = el('tr');
    TABLE_COLUMNS.forEach((col) => {
      const th = el('th', { text: col.label });
      if (currentSort.column === col.key) th.classList.add(`sorted-${currentSort.direction}`);
      th.addEventListener('click', () => {
        if (currentSort.column === col.key) {
          currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort = { column: col.key, direction: col.key === 'name' ? 'asc' : 'desc' };
        }
        renderTableAndChart();
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    const sorted = sortRows(rows, currentSort.column, currentSort.direction);
    const tagResolver = currentTagResolver();
    sorted.forEach((row) => {
      const nameCell = el('td', { text: row.name });
      const category = tagResolver && tagResolver(row.name, row.taxid);
      if (category) {
        const badge = el('span', { className: 'tag-badge', text: category });
        badge.style.borderColor = colorForCategory(category);
        nameCell.appendChild(badge);
      }
      const tr = el('tr', {}, [
        nameCell,
        el('td', { text: row.cladeReads.toLocaleString() }),
        el('td', { text: `${row.pctOfTotal.toFixed(3)}%` }),
      ]);
      if (matchesSearch(row.name, row.taxid, globalSearchText)) tr.classList.add('search-match');

      if (row.taxid !== undefined) {
        tr.classList.add('expandable-row');
        tr.title = 'Click for full lineage, cross-sample abundance, and a BLAST Explorer link';
        tr.addEventListener('click', () => {
          if (expandedTaxids.has(row.taxid)) expandedTaxids.delete(row.taxid);
          else expandedTaxids.add(row.taxid);
          renderTableAndChart();
        });
      }
      tbody.appendChild(tr);

      if (row.taxid !== undefined && expandedTaxids.has(row.taxid)) {
        const detailTr = el('tr', { className: 'taxon-detail-row' });
        const detailTd = el('td', { colspan: '3' });
        detailTd.appendChild(renderTaxonDetailCard(row.taxid, tagResolver));
        detailTr.appendChild(detailTd);
        tbody.appendChild(detailTr);
      }
    });
    table.appendChild(tbody);

    return el('div', {}, [
      el('p', { className: 'row-count', text: `${rows.length} taxa` }),
      el('div', { className: 'table-wrap scroll-panel' }, [table]),
    ]);
  }

  function renderTopNChart(rows) {
    const container = el('div', { className: 'topn-chart' });
    const controls = el('div', { className: 'topn-controls' });
    const nInput = el('input', { type: 'number', min: '1', max: '100', value: String(topN) });
    nInput.addEventListener('change', () => {
      topN = Math.max(1, Number(nInput.value) || 15);
      renderTableAndChart();
    });
    controls.appendChild(el('label', { text: 'Top N: ' }));
    controls.appendChild(nInput);
    container.appendChild(controls);

    const { top, other } = computeTopN(rows, topN);
    const maxReads = top.length > 0 ? top[0].cladeReads : 0;
    const bars = el('div', { className: 'bar-list scroll-panel' });
    const tagResolver = currentTagResolver();

    const addBar = (label, reads, pct, cls, taxid) => {
      const highlighted = matchesSearch(label, taxid, globalSearchText);
      const barRow = el('div', { className: `bar-row ${cls || ''} ${highlighted ? 'search-match' : ''}` });
      const labelSpan = el('span', { className: 'bar-label', text: label });
      const category = tagResolver && taxid !== undefined && tagResolver(label, taxid);
      if (category) labelSpan.style.borderLeft = `3px solid ${colorForCategory(category)}`;
      barRow.appendChild(labelSpan);
      const track = el('div', { className: 'bar-track' });
      const fill = el('div', { className: 'bar-fill' });
      fill.style.width = `${maxReads > 0 ? (100 * reads) / maxReads : 0}%`;
      track.appendChild(fill);
      barRow.appendChild(track);
      barRow.appendChild(el('span', { className: 'bar-value', text: `${reads.toLocaleString()} (${pct.toFixed(2)}%)` }));
      bars.appendChild(barRow);
    };

    top.forEach((row) => addBar(row.name, row.cladeReads, row.pctOfTotal, '', row.taxid));
    if (other) addBar(`Other (${other.count} taxa)`, other.cladeReads, other.pctOfTotal, 'bar-other');

    container.appendChild(bars);
    return container;
  }

  function renderTableAndChart() {
    const tableHost = document.getElementById('rank-table-host');
    const chartHost = document.getElementById('topn-chart-host');
    if (!tableHost || !chartHost) return;
    const sample = run.samples.get(activeSampleId);
    if (!sample) return;
    const rows = getTableRows(sample);
    tableHost.innerHTML = '';
    tableHost.appendChild(renderTable(rows));
    chartHost.innerHTML = '';
    chartHost.appendChild(renderTopNChart(rows));
  }

  // ---- Sunburst (Krona-style) -----------------------------------------

  function renderSunburstSection(sample) {
    const hierarchyRoot = buildHierarchyTree(run.tree, sample.id, currentFilters());
    if (!hierarchyRoot) return null;

    const section = el('div', { className: 'card' });
    section.appendChild(el('h3', { text: 'Taxonomic sunburst' }));
    const breadcrumb = el('p', { className: 'hint', text: 'root — click a segment to zoom in, click the centre to zoom out' });
    section.appendChild(breadcrumb);
    const host = el('div', { className: 'sunburst-host' });
    section.appendChild(host);

    renderSunburstSVG(host, hierarchyRoot, {
      size: 460,
      isHighlighted: (name, taxid) => matchesSearch(name, taxid, globalSearchText),
      tagFor: currentTagResolver(),
      colorForCategory,
      onFocusChange: (focus) => {
        breadcrumb.textContent =
          focus.depth <= 0
            ? 'root — click a segment to zoom in, click the centre to zoom out'
            : `${focus.name} (${focus.cladeReads.toLocaleString()} reads) — click a segment to zoom in, click the centre to zoom out`;
      },
    });
    section.appendChild(createExportButtons(() => host, `${sample.id}-sunburst`));

    return section;
  }

  // ---- Sankey (Pavian-style) --------------------------------------------

  let sankeyStartRank = null;
  let sankeyEndRank = null;
  let sankeyMaxNodesPerColumn = 12;

  function renderSankeySection(sample) {
    const ranks = computeAvailableRanks(run.tree, sample.id);
    if (ranks.length < 2) return null;

    if (!sankeyStartRank || !ranks.includes(sankeyStartRank)) sankeyStartRank = ranks[0];
    if (!sankeyEndRank || !ranks.includes(sankeyEndRank)) sankeyEndRank = ranks[ranks.length - 1];

    const section = el('div', { className: 'card' });
    section.appendChild(el('h3', { text: 'Sankey: read flow through ranks' }));

    const controls = el('div', { className: 'sankey-controls' });
    const startSelect = el('select');
    const endSelect = el('select');
    ranks.forEach((r) => {
      const startOpt = el('option', { value: r, text: r });
      startOpt.selected = r === sankeyStartRank;
      startSelect.appendChild(startOpt);
      const endOpt = el('option', { value: r, text: r });
      endOpt.selected = r === sankeyEndRank;
      endSelect.appendChild(endOpt);
    });
    controls.appendChild(el('label', { text: 'From rank: ' }));
    controls.appendChild(startSelect);
    controls.appendChild(el('label', { text: ' to rank: ' }));
    controls.appendChild(endSelect);

    const maxNodesInput = el('input', { type: 'number', min: '2', max: '40', value: String(sankeyMaxNodesPerColumn) });
    controls.appendChild(el('label', { text: ' max taxa shown per rank: ' }));
    controls.appendChild(maxNodesInput);
    section.appendChild(controls);

    const note = el('p', { className: 'hint sankey-note' });
    section.appendChild(note);

    const host = el('div', { className: 'sankey-host' });
    section.appendChild(host);

    function draw() {
      const startIdx = ranks.indexOf(sankeyStartRank);
      const endIdx = ranks.indexOf(sankeyEndRank);
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const rankRange = ranks.slice(lo, hi + 1);
      if (rankRange.length < 2) {
        host.innerHTML = '';
        note.textContent = '';
        host.appendChild(el('p', { className: 'empty-state', text: 'Pick two different ranks to draw a flow diagram.' }));
        return;
      }
      const data = computeSankeyData(run.tree, sample.id, rankRange, {
        filters: currentFilters(),
        maxNodesPerColumn: sankeyMaxNodesPerColumn,
      });
      const width = Math.max(600, host.clientWidth || 700);
      const layout = computeSankeyLayout(data, { width, height: 420 });
      renderSankeySVG(host, layout, {
        width,
        height: 420,
        isHighlighted: (name, taxid) => matchesSearch(name, taxid, globalSearchText),
        tagFor: currentTagResolver(),
        colorForCategory,
      });

      // Only the largest `sankeyMaxNodesPerColumn` taxa per rank (after the
      // global filters) are drawn — smaller ones are left out rather than
      // lumped into a meaningless "Other" group, so bar heights are a
      // fraction of the whole sample and columns cover less height at
      // finer ranks as more reads fall outside what's shown.
      const finestCol = data.columns[data.columns.length - 1];
      const shownReads = finestCol.nodes.reduce((s, n) => s + n.cladeReads, 0);
      const shownPct = data.grandTotal > 0 ? (100 * shownReads) / data.grandTotal : 0;
      const hiddenPct = data.grandTotal > 0 ? (100 * finestCol.hiddenReads) / data.grandTotal : 0;
      note.textContent = finestCol.hiddenCount > 0
        ? `Showing the ${finestCol.nodes.length} largest taxa at ${finestCol.rank} rank (${shownPct.toFixed(1)}% of reads). ${finestCol.hiddenCount} smaller taxa (${hiddenPct.toFixed(1)}% of reads) are below the minimum-abundance filter or outside the top ${sankeyMaxNodesPerColumn} and are not shown.`
        : `Showing all ${finestCol.nodes.length} taxa at ${finestCol.rank} rank (${shownPct.toFixed(1)}% of reads).`;
    }

    startSelect.addEventListener('change', () => {
      sankeyStartRank = startSelect.value;
      draw();
    });
    endSelect.addEventListener('change', () => {
      sankeyEndRank = endSelect.value;
      draw();
    });
    maxNodesInput.addEventListener('change', () => {
      sankeyMaxNodesPerColumn = Math.max(2, Number(maxNodesInput.value) || 12);
      draw();
    });

    draw();
    section.appendChild(createExportButtons(() => host, `${sample.id}-sankey`));
    return section;
  }

  // ---- Multi-sample comparison + overview dashboard (PLAN.md Phase 5) --
  //
  // Everything here reads through summarizeGroups/currentGroupNames (see
  // the Sample groups section above) rather than filtering run.samples
  // itself, so it stays correct automatically as groups are retyped or
  // reassigned. "Included" = every loaded sample except those set to
  // Exclude — unassigned samples are still compared, just uncoloured.

  const GROUP_PALETTE = [
    'hsl(160, 55%, 45%)',
    'hsl(260, 55%, 60%)',
    'hsl(30, 75%, 55%)',
    'hsl(200, 65%, 55%)',
    'hsl(340, 60%, 60%)',
    'hsl(80, 50%, 45%)',
    'hsl(10, 65%, 55%)',
    'hsl(280, 40%, 55%)',
  ];
  const UNASSIGNED_COLOR = 'hsl(0, 0%, 60%)';

  function colorForGroup(groupName, groupNames) {
    if (!groupName || groupName === EXCLUDE) return UNASSIGNED_COLOR;
    const idx = groupNames.indexOf(groupName);
    return idx === -1 ? UNASSIGNED_COLOR : GROUP_PALETTE[idx % GROUP_PALETTE.length];
  }

  /** Included (non-excluded) samples, ordered group-block-first then unassigned, matching every other group-aware view. */
  function orderedIncludedSamples() {
    const groupNames = currentGroupNames();
    const summary = summarizeGroups(run.samples, groupNames);
    const orderedIds = [...summary.byGroup.values()].flat().concat(summary.unassigned);
    return orderedIds.map((id) => run.samples.get(id));
  }

  function unionAvailableRanks(sampleIds) {
    const present = new Set();
    sampleIds.forEach((id) => computeAvailableRanks(run.tree, id).forEach((r) => present.add(r)));
    return RANK_ORDER.filter((r) => present.has(r));
  }

  let comparisonRank = null;

  function renderComparisonRankControl(sampleIds, onChange) {
    const ranks = unionAvailableRanks(sampleIds);
    if (!comparisonRank || !ranks.includes(comparisonRank)) comparisonRank = ranks[ranks.length - 1] || null;
    const select = el('select');
    ranks.forEach((r) => {
      const opt = el('option', { value: r, text: r });
      opt.selected = r === comparisonRank;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      comparisonRank = select.value;
      onChange();
    });
    return { control: el('div', { className: 'rank-controls' }, [el('label', { text: 'Rank: ' }), select]), ranks };
  }

  // ---- Overview dashboard ----------------------------------------------

  let overviewMetric = 'shannon';
  const METRIC_LABELS = { richness: 'Richness', shannon: 'Shannon index', simpson: 'Simpson’s Index of Diversity' };

  function renderOverviewDashboard() {
    const included = orderedIncludedSamples().filter((s) => s.kind !== 'generic');
    if (included.length < 2) return null;

    const groupNames = currentGroupNames();
    const section = el('div', { className: 'card overview-dashboard' });
    section.appendChild(el('h3', { text: 'Overview' }));

    // Per-rank resolution: % of a sample's total reads assigned to a taxon
    // at this rank or deeper — distinct from Classified % (root-level,
    // classified vs. unclassified), since a classified read can still stop
    // resolving above any given rank.
    //
    // cladeReads is baked in at parse time (each node's own stored total
    // already includes every descendant's reads), so excluding a deep
    // clade doesn't retroactively shrink its ancestors' stored cladeReads
    // — an ancestor rank's raw sum still counts the excluded clade's reads
    // even though totalReads (via computeExcludedClassifiedReads) has
    // already subtracted them, which is what pushed these percentages
    // over 100%. `extra[i]` below is exactly the correction
    // computeExcludedClassifiedReads applies at the root, generalized to
    // every ancestor of every excluded clade: the total reads of each
    // topmost-pruned clade, propagated up through every ancestor's own
    // running total. Minimum-abundance is deliberately excluded from the
    // prune mask, matching totalReads/Classified %'s own exclusion-only
    // semantics (display filter, not a read-count reduction).
    const rankColumns = unionAvailableRanks(included.map((s) => s.id));
    const filters = currentFilters();
    function rankResolutionPct(sampleId, totalReads) {
      if (totalReads <= 0) return rankColumns.map(() => 0);
      const tree = run.tree;
      const pruned = computeTreePruneMask(tree, sampleId, { exclusionTerms: filters.exclusionTerms });
      const extra = new Float64Array(tree.size);
      for (let i = 0; i < tree.size; i++) {
        if (!pruned[i]) continue;
        const parentIdx = tree.parentIndex[i];
        if (parentIdx !== -1 && pruned[parentIdx]) continue; // not the topmost node of this excluded clade
        const counts = tree.perSample[i].get(sampleId);
        const reads = counts ? counts.cladeReads || 0 : 0;
        if (reads === 0) continue;
        for (let p = parentIdx; p !== -1; p = tree.parentIndex[p]) extra[p] += reads;
      }
      const rankIndex = new Map(rankColumns.map((r, idx) => [r, idx]));
      const resolvedByRank = rankColumns.map(() => 0);
      for (let i = 0; i < tree.size; i++) {
        if (pruned[i] || tree.rankSub[i] !== 0) continue;
        const idx = rankIndex.get(tree.rankLetter[i]);
        if (idx === undefined) continue;
        const counts = tree.perSample[i].get(sampleId);
        if (!counts) continue;
        resolvedByRank[idx] += Math.max(0, (counts.cladeReads || 0) - extra[i]);
      }
      return rankColumns.map((_, idx) => (100 * resolvedByRank[idx]) / totalReads);
    }
    // Both tables gain a column per rank on top of their fixed columns —
    // wrap in .table-wrap so they scroll horizontally rather than
    // squeezing illegibly narrow on smaller windows.
    const tableMinWidth = `${420 + rankColumns.length * 64}px`;

    // Per-sample stats first — the group summary below aggregates these,
    // but the individual numbers behind a mean are often exactly what you
    // want to check (e.g. spotting the one sample dragging a group's
    // classified % down, or the one that stops resolving at Family).
    section.appendChild(el('h4', { text: 'Per sample' }));
    const perSampleTable = el('table', { className: 'overview-stats-table', style: `min-width:${tableMinWidth}` });
    const perSampleHead = el('tr', {}, ['Sample', 'Group', 'Total reads', 'Classified %', ...rankColumns.map((r) => `${r} %`)].map((h) => el('th', { text: h })));
    perSampleTable.appendChild(el('thead', {}, [perSampleHead]));
    const perSampleBody = el('tbody');
    included.forEach((s) => {
      const stat = computeSampleSummary(run.tree, s.id, { filters });
      const rankPcts = rankResolutionPct(s.id, stat.totalReads);
      perSampleBody.appendChild(
        el('tr', {}, [
          el('td', { text: s.id }),
          el('td', { text: s.group || '—' }),
          el('td', { text: stat.totalReads.toLocaleString() }),
          el('td', { text: `${stat.classifiedPct.toFixed(1)}%` }),
          ...rankPcts.map((pct) => el('td', { text: `${pct.toFixed(1)}%` })),
        ])
      );
    });
    perSampleTable.appendChild(perSampleBody);
    section.appendChild(el('div', { className: 'table-wrap' }, [perSampleTable]));

    // Run-level stats, per group when >1 group has samples.
    const summary = summarizeGroups(run.samples, groupNames);
    const activeGroups = groupNames.filter((g) => summary.byGroup.get(g).length > 0);
    const buckets =
      activeGroups.length > 1
        ? activeGroups.map((g) => ({ label: g, ids: summary.byGroup.get(g) }))
        : [{ label: 'All samples', ids: included.map((s) => s.id) }];
    if (summary.unassigned.length > 0 && activeGroups.length > 1) {
      buckets.push({ label: 'Unassigned', ids: summary.unassigned });
    }

    // Mean-only throughout (no range) — the per-sample table above already
    // shows every individual value, so the range is a glance away rather
    // than duplicated here, which is what makes room for the rank columns.
    section.appendChild(el('h4', { text: 'Group summary' }));
    const statsTable = el('table', { className: 'overview-stats-table', style: `min-width:${tableMinWidth}` });
    const headRow = el('tr', {}, ['Group', 'n', 'Total reads (mean)', 'Classified % (mean)', ...rankColumns.map((r) => `${r} % (mean)`)].map((h) => el('th', { text: h })));
    statsTable.appendChild(el('thead', {}, [headRow]));
    const tbody = el('tbody');
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    buckets.forEach((bucket) => {
      const bucketSamples = bucket.ids.map((id) => run.samples.get(id)).filter((s) => s && s.kind !== 'generic');
      if (bucketSamples.length === 0) return;
      const stats = bucketSamples.map((s) => computeSampleSummary(run.tree, s.id, { filters }));
      const rankPctsPerSample = bucketSamples.map((s, i) => rankResolutionPct(s.id, stats[i].totalReads));
      const meanRankPcts = rankColumns.map((_, rIdx) => mean(rankPctsPerSample.map((pcts) => pcts[rIdx])));
      const totals = stats.map((s) => s.totalReads);
      const pcts = stats.map((s) => s.classifiedPct);
      tbody.appendChild(
        el('tr', {}, [
          el('td', { text: bucket.label }),
          el('td', { text: String(stats.length) }),
          el('td', { text: Math.round(mean(totals)).toLocaleString() }),
          el('td', { text: `${mean(pcts).toFixed(1)}%` }),
          ...meanRankPcts.map((pct) => el('td', { text: `${pct.toFixed(1)}%` })),
        ])
      );
    });
    statsTable.appendChild(tbody);
    section.appendChild(el('div', { className: 'table-wrap' }, [statsTable]));

    // Diversity plot: metric selector + rank-aware per-group mean/range and per-sample points.
    const controlsRow = el('div', { className: 'overview-controls' });
    const metricSelect = el('select');
    Object.entries(METRIC_LABELS).forEach(([key, label]) => {
      const opt = el('option', { value: key, text: label });
      opt.selected = key === overviewMetric;
      metricSelect.appendChild(opt);
    });
    metricSelect.addEventListener('change', () => {
      overviewMetric = metricSelect.value;
      renderResults();
    });
    controlsRow.appendChild(el('label', { text: 'Diversity metric: ' }));
    controlsRow.appendChild(metricSelect);
    section.appendChild(controlsRow);

    const rankInfo = renderComparisonRankControl(included.map((s) => s.id), renderResults);
    section.appendChild(rankInfo.control);

    if (comparisonRank) {
      const samplesWithGroup = included.map((s) => ({ id: s.id, group: s.group || 'Unassigned' }));
      const diversitySummary = computeDiversitySummary(run.tree, samplesWithGroup, comparisonRank, currentFilters());
      section.appendChild(renderDiversityPlot(diversitySummary, overviewMetric, groupNames));

      const ordinationSection = renderOrdinationSection(included, groupNames);
      if (ordinationSection) section.appendChild(ordinationSection);
    }

    return section;
  }

  // ---- Ordination (PCoA) ------------------------------------------------

  let ordinationColorField = null; // null => colour by group; otherwise a metadata field name

  function unionMetadataFieldNames(samples) {
    const fields = new Set();
    samples.forEach((s) => {
      if (s.metadata) Object.keys(s.metadata).forEach((k) => fields.add(k));
    });
    return [...fields];
  }

  function isNumericMetadataField(samples, field) {
    const values = samples
      .map((s) => s.metadata && s.metadata[field])
      .filter((v) => v !== undefined && v !== null && v !== '');
    return values.length > 0 && values.every((v) => v !== '' && !Number.isNaN(Number(v)));
  }

  function colorForCategoricalValue(value) {
    let hash = 0;
    const str = String(value);
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return `hsl(${hash % 360}, 55%, 50%)`;
  }

  function renderOrdinationSection(included, groupNames) {
    const container = el('div', { className: 'ordination-section' });
    container.appendChild(el('h4', { text: 'Ordination (PCoA on Bray-Curtis)' }));

    if (included.length < 3) {
      container.appendChild(el('p', { className: 'empty-state', text: 'Ordination needs at least 3 included samples.' }));
      return container;
    }

    const sampleIds = included.map((s) => s.id);
    const { sampleIds: distIds, matrix: distMatrix } = computeDistanceMatrix(
      run.tree,
      sampleIds,
      comparisonRank,
      'bray-curtis',
      { filters: currentFilters() }
    );
    const pcoa = computePCoA(distMatrix, 2);
    if (!pcoa) {
      container.appendChild(el('p', { className: 'empty-state', text: 'Not enough samples to compute an ordination.' }));
      return container;
    }

    const byId = new Map(included.map((s) => [s.id, s]));
    const metadataFields = unionMetadataFieldNames(included);

    const controlsRow = el('div', { className: 'overview-controls' });
    controlsRow.appendChild(el('label', { text: 'Colour by: ' }));
    const colorSelect = el('select');
    const groupOpt = el('option', { value: '__group__', text: 'Group' });
    groupOpt.selected = !ordinationColorField;
    colorSelect.appendChild(groupOpt);
    metadataFields.forEach((f) => {
      const opt = el('option', { value: f, text: f });
      opt.selected = ordinationColorField === f;
      colorSelect.appendChild(opt);
    });
    colorSelect.addEventListener('change', () => {
      ordinationColorField = colorSelect.value === '__group__' ? null : colorSelect.value;
      renderResults();
    });
    controlsRow.appendChild(colorSelect);
    container.appendChild(controlsRow);

    let colorFn;
    let colorLegend = null; // only shown when colour encodes something other than group (which the shape legend already shows)
    if (!ordinationColorField) {
      colorFn = (sampleId) => colorForGroup(byId.get(sampleId).group, groupNames);
    } else {
      const field = ordinationColorField;
      if (isNumericMetadataField(included, field)) {
        const values = distIds
          .map((id) => Number(byId.get(id).metadata && byId.get(id).metadata[field]))
          .filter((v) => !Number.isNaN(v));
        const min = Math.min(...values);
        const max = Math.max(...values);
        const scaleColor = (v) => sequentialColor(v, min, max, { hue: 210 });
        colorFn = (sampleId) => {
          const raw = byId.get(sampleId).metadata && byId.get(sampleId).metadata[field];
          const v = Number(raw);
          return Number.isNaN(v) ? UNASSIGNED_COLOR : scaleColor(v);
        };
        colorLegend = { kind: 'numeric', min, max, label: field, colorFn: scaleColor };
      } else {
        const categories = [
          ...new Set(
            distIds
              .map((id) => byId.get(id).metadata && byId.get(id).metadata[field])
              .filter((v) => v !== undefined && v !== null && v !== '')
          ),
        ];
        colorFn = (sampleId) => {
          const v = byId.get(sampleId).metadata && byId.get(sampleId).metadata[field];
          return v === undefined || v === null || v === '' ? UNASSIGNED_COLOR : colorForCategoricalValue(v);
        };
        colorLegend = { kind: 'categorical', items: categories.map((c) => ({ label: String(c), color: colorForCategoricalValue(c) })) };
      }
    }

    const shapeLegend = groupNames.map((g, i) => ({ label: g, shapeIndex: i, color: colorForGroup(g, groupNames) }));
    const unassignedShapeIndex = groupNames.length; // one shape beyond the last group's, so it never collides

    const points = distIds.map((sampleId, i) => {
      const sample = byId.get(sampleId);
      const groupIdx = sample.group ? groupNames.indexOf(sample.group) : -1;
      return {
        sampleId,
        x: pcoa.points[i][0] || 0,
        y: pcoa.points[i][1] || 0,
        shapeIndex: groupIdx >= 0 ? groupIdx : unassignedShapeIndex,
        color: colorFn(sampleId),
        tooltip: sample.group ? `${sampleId} (${sample.group})` : sampleId,
      };
    });

    const ordinationHost = el('div', { className: 'ordination-host' });
    container.appendChild(ordinationHost);
    renderOrdinationSVG(ordinationHost, {
      points,
      xLabel: `PCo1 (${pcoa.varianceExplained[0].toFixed(1)}% var)`,
      yLabel: `PCo2 (${(pcoa.varianceExplained[1] || 0).toFixed(1)}% var)`,
      shapeLegend,
      colorLegend,
    });
    container.appendChild(createExportButtons(() => ordinationHost, 'ordination-pcoa'));

    return container;
  }

  function renderDiversityPlot(diversitySummary, metric, groupNames) {
    const container = el('div', { className: 'diversity-plot' });
    const allValues = diversitySummary.perSample.map((s) => s[metric]);
    const min = Math.min(...allValues, 0);
    const max = Math.max(...allValues, 1e-9);
    const scale = (v) => (max > min ? ((v - min) / (max - min)) * 100 : 50);

    const axisRow = el('div', { className: 'diversity-row diversity-axis-row' });
    axisRow.appendChild(el('span', { className: 'diversity-group-label' }));
    const axisTrack = el('div', { className: 'diversity-axis' });
    const tickCount = 5;
    for (let i = 0; i < tickCount; i++) {
      const t = i / (tickCount - 1);
      const value = min + t * (max - min);
      const tick = el('div', { className: 'diversity-axis-tick' });
      tick.style.left = `${t * 100}%`;
      tick.appendChild(el('span', { className: 'diversity-axis-tick-mark' }));
      tick.appendChild(el('span', { className: 'diversity-axis-tick-label', text: value.toFixed(2) }));
      axisTrack.appendChild(tick);
    }
    axisRow.appendChild(axisTrack);
    axisRow.appendChild(el('span', { className: 'diversity-value', text: metric }));
    container.appendChild(axisRow);

    for (const [group, agg] of diversitySummary.groupAggregates) {
      const row = el('div', { className: 'diversity-row' });
      row.appendChild(el('span', { className: 'diversity-group-label', text: group }));
      const track = el('div', { className: 'diversity-track' });

      const rangeBar = el('div', { className: 'diversity-range' });
      rangeBar.style.left = `${scale(agg[metric].min)}%`;
      rangeBar.style.width = `${Math.max(0.5, scale(agg[metric].max) - scale(agg[metric].min))}%`;
      track.appendChild(rangeBar);

      const meanMarker = el('div', { className: 'diversity-mean' });
      meanMarker.style.left = `${scale(agg[metric].mean)}%`;
      track.appendChild(meanMarker);

      diversitySummary.perSample
        .filter((s) => s.group === group)
        .forEach((s) => {
          const dot = el('div', { className: 'diversity-dot' });
          dot.style.left = `${scale(s[metric])}%`;
          dot.style.background = colorForGroup(group === 'Unassigned' ? null : group, groupNames);
          dot.title = `${s.id}: ${s[metric].toFixed(3)}`;
          track.appendChild(dot);
        });

      row.appendChild(track);
      row.appendChild(
        el('span', {
          className: 'diversity-value',
          text: `${agg[metric].mean.toFixed(2)} (${agg[metric].min.toFixed(2)}–${agg[metric].max.toFixed(2)})`,
        })
      );
      container.appendChild(row);
    }
    return container;
  }

  // ---- Multi-sample comparison core -------------------------------------

  let stackedBarTopN = 10;
  let stackedBarMode = 'pct'; // 'pct' | 'raw' — see renderStackedBarSVG for what each does
  let heatmapMaxRows = 50;
  let presenceThreshold = 1;
  let similarityMetric = 'bray-curtis';

  function sampleGroupLabelFn(samples) {
    const byId = new Map(samples.map((s) => [s.id, s]));
    return (id) => {
      const s = byId.get(id);
      return s && s.group ? `${id} (${s.group})` : id;
    };
  }

  function renderComparisonSection() {
    const included = orderedIncludedSamples().filter((s) => s.kind !== 'generic');
    if (included.length < 2) return null;

    const groupNames = currentGroupNames();
    const sampleIds = included.map((s) => s.id);
    const colGroupColors = included.map((s) => colorForGroup(s.group, groupNames));

    const section = el('div', { className: 'card comparison-section' });
    section.appendChild(el('h3', { text: 'Multi-sample comparison' }));

    const rankInfo = renderComparisonRankControl(sampleIds, renderResults);
    section.appendChild(rankInfo.control);
    if (!comparisonRank) {
      section.appendChild(el('p', { className: 'empty-state', text: 'No shared rank available across the included samples.' }));
      return section;
    }

    // Stacked composition bar chart
    section.appendChild(el('h4', { text: 'Composition' }));
    const topNRow = el('div', { className: 'topn-controls' });
    const topNInput = el('input', { type: 'number', min: '2', max: '30', value: String(stackedBarTopN) });
    topNInput.addEventListener('change', () => {
      stackedBarTopN = Math.max(2, Number(topNInput.value) || 10);
      renderResults();
    });
    topNRow.appendChild(el('label', { text: 'Top N taxa: ' }));
    topNRow.appendChild(topNInput);
    section.appendChild(topNRow);

    // Display mode: % normalizes every bar to the same 100%-tall stack
    // (composition is directly comparable regardless of depth); raw counts
    // scales every bar against one shared read-count axis, so bar height
    // itself shows sequencing-depth differences between samples.
    const modeRow = el('div', { className: 'topn-controls' });
    const modeSelect = el('select');
    [
      ['pct', '% of sample'],
      ['raw', 'Read count'],
    ].forEach(([value, label]) => {
      const opt = el('option', { value, text: label });
      opt.selected = value === stackedBarMode;
      modeSelect.appendChild(opt);
    });
    modeSelect.addEventListener('change', () => {
      stackedBarMode = modeSelect.value;
      renderResults();
    });
    modeRow.appendChild(el('label', { text: 'Display: ' }));
    modeRow.appendChild(modeSelect);
    section.appendChild(modeRow);

    const tagResolver = currentTagResolver();

    const stackedHost = el('div', { className: 'stacked-bar-host' });
    section.appendChild(stackedHost);
    const stackedData = computeStackedComposition(run.tree, sampleIds, comparisonRank, stackedBarTopN, currentFilters());
    renderStackedBarSVG(stackedHost, stackedData, {
      mode: stackedBarMode,
      sampleLabels: sampleGroupLabelFn(included),
      isTaxonHighlighted: (name) => comparisonHighlightMatch(name, null),
      onLegendClick: (name) => {
        legendHighlightName = legendHighlightName === name ? null : name;
        renderResults();
      },
      // No taxid available on stacked-composition rows (see comparison.js
      // computeStackedComposition), so tagging here matches by name only —
      // fine for the uploaded name/taxid list's name half and for keyword
      // rules, just not for a tag uploaded purely by taxid.
      tagForTaxon: tagResolver ? (name) => tagResolver(name, undefined) : null,
      colorForCategory,
    });
    section.appendChild(createExportButtons(() => stackedHost, 'composition'));

    // Abundance heatmap
    section.appendChild(el('h4', { text: 'Abundance heatmap' }));
    // Cell colour is % of each sample's total (depth-independent — a
    // taxon that's actually more prevalent reads darker regardless of how
    // deeply that particular sample was sequenced), which is what makes
    // colour meaningful to compare across columns. The raw read count a
    // sample's sequencing depth is still one hover away via tooltipMatrix
    // below, and the CSV export (built from rawAbundanceMatrix, not this
    // one) stays raw counts for downstream tools that expect them.
    const abundanceMatrix = buildAbundanceMatrix(run.tree, sampleIds, comparisonRank, {
      valueField: 'pctOfTotal',
      secondaryValueField: 'cladeReads',
      filters: currentFilters(),
    });
    const rawAbundanceMatrix = { taxa: abundanceMatrix.taxa, sampleIds: abundanceMatrix.sampleIds, matrix: abundanceMatrix.secondaryMatrix };
    const cappedAbundance = {
      ...abundanceMatrix,
      taxa: abundanceMatrix.taxa.slice(0, heatmapMaxRows),
      matrix: abundanceMatrix.matrix.slice(0, heatmapMaxRows),
      secondaryMatrix: abundanceMatrix.secondaryMatrix.slice(0, heatmapMaxRows),
    };
    const taxidByName = new Map(cappedAbundance.taxa.map((t) => [t.name, t.taxid]));
    const tagForRow = tagResolver ? (name) => tagResolver(name, taxidByName.get(name)) : null;
    section.appendChild(
      el('p', {
        className: 'row-count',
        text: `Showing top ${Math.min(heatmapMaxRows, abundanceMatrix.taxa.length)} of ${abundanceMatrix.taxa.length} taxa by total relative abundance.`,
      })
    );
    const heatmapHost = el('div', { className: 'heatmap-host scroll-panel' });
    section.appendChild(heatmapHost);
    renderHeatmapSVG(heatmapHost, {
      rowLabels: cappedAbundance.taxa.map((t) => t.name),
      colLabels: sampleIds.map(sampleGroupLabelFn(included)),
      matrix: cappedAbundance.matrix,
      valueUnit: '%',
      tooltipMatrix: cappedAbundance.secondaryMatrix,
      tooltipUnit: ' reads',
      colGroupColors,
      isRowHighlighted: (name) => comparisonHighlightMatch(name, null),
      tagForRow,
      colorForCategory,
    });
    section.appendChild(createExportButtons(() => heatmapHost, 'abundance-heatmap'));
    section.appendChild(
      el('p', {
        className: 'hint',
        text: `Exports every taxon at the "${comparisonRank}" rank selected above (not just the top ${heatmapMaxRows} shown), as raw read counts — not the percentages the heatmap above is now coloured from.`,
      })
    );
    const abundanceCsvBtn = el('button', { className: 'act', type: 'button', text: 'Export full matrix as CSV' });
    abundanceCsvBtn.addEventListener('click', () => {
      const groupBySampleId = Object.fromEntries(included.map((s) => [s.id, s.group || '']));
      downloadTextFile(`abundance-matrix-${comparisonRank}.csv`, abundanceMatrixToCsv(rawAbundanceMatrix, groupBySampleId));
    });
    section.appendChild(el('div', { className: 'diagram-export-row' }, [abundanceCsvBtn]));

    // Presence/absence matrix
    section.appendChild(el('h4', { text: 'Presence / absence' }));
    const thresholdRow = el('div', { className: 'topn-controls' });
    const thresholdInput = el('input', { type: 'number', min: '1', value: String(presenceThreshold) });
    thresholdInput.addEventListener('change', () => {
      presenceThreshold = Math.max(1, Number(thresholdInput.value) || 1);
      renderResults();
    });
    thresholdRow.appendChild(el('label', { text: 'Minimum reads to count as present: ' }));
    thresholdRow.appendChild(thresholdInput);
    section.appendChild(thresholdRow);

    // Presence/absence calls a taxon "present" against a raw-read-count
    // threshold (see the label below), so it must run on cappedAbundance's
    // raw-count secondaryMatrix, not its now-percentage matrix.
    const cappedRawAbundance = { taxa: cappedAbundance.taxa, sampleIds: cappedAbundance.sampleIds, matrix: cappedAbundance.secondaryMatrix };
    const presenceAbsence = toPresenceAbsence(cappedRawAbundance, presenceThreshold);
    const presenceHost = el('div', { className: 'heatmap-host scroll-panel' });
    section.appendChild(presenceHost);
    renderHeatmapSVG(presenceHost, {
      rowLabels: presenceAbsence.taxa.map((t) => t.name),
      colLabels: sampleIds.map(sampleGroupLabelFn(included)),
      matrix: presenceAbsence.matrix,
      colorFn: binaryColor,
      colGroupColors,
      isRowHighlighted: (name) => comparisonHighlightMatch(name, null),
      tagForRow,
      colorForCategory,
    });
    section.appendChild(createExportButtons(() => presenceHost, 'presence-absence'));

    // Small multiples sunburst
    section.appendChild(el('h4', { text: 'Community structure (small multiples)' }));
    const smallMultiples = el('div', { className: 'small-multiples' });
    section.appendChild(smallMultiples);
    included.forEach((sample) => {
      const hierarchyRoot = buildHierarchyTree(run.tree, sample.id, currentFilters());
      if (!hierarchyRoot) return;
      const cell = el('div', { className: 'small-multiple-cell' });
      cell.appendChild(el('p', { className: 'small-multiple-label', text: sampleGroupLabelFn(included)(sample.id) }));
      const host = el('div', {});
      cell.appendChild(host);
      renderSunburstSVG(host, hierarchyRoot, {
        size: 140,
        ringWidth: 12,
        centerR: 10,
        maxDepth: 5,
        isHighlighted: (name, taxid) => comparisonHighlightMatch(name, taxid),
      });
      smallMultiples.appendChild(cell);
    });

    // Diversity summary table
    section.appendChild(el('h4', { text: 'Diversity summary' }));
    const samplesWithGroup = included.map((s) => ({ id: s.id, group: s.group || 'Unassigned' }));
    const diversitySummary = computeDiversitySummary(run.tree, samplesWithGroup, comparisonRank, currentFilters());
    const divTable = el('table', { className: 'rank-table' });
    const divHead = el('tr', {}, ['Sample', 'Group', 'Richness', 'Shannon', 'Simpson'].map((h) => el('th', { text: h })));
    divTable.appendChild(el('thead', {}, [divHead]));
    const divBody = el('tbody');
    diversitySummary.perSample.forEach((s) => {
      divBody.appendChild(
        el('tr', {}, [
          el('td', { text: s.id }),
          el('td', { text: s.group }),
          el('td', { text: String(s.richness) }),
          el('td', { text: s.shannon.toFixed(3) }),
          el('td', { text: s.simpson.toFixed(3) }),
        ])
      );
    });
    for (const [group, agg] of diversitySummary.groupAggregates) {
      divBody.appendChild(
        el('tr', { className: 'diversity-aggregate-row' }, [
          el('td', { text: `${group} (mean)` }),
          el('td', { text: '' }),
          el('td', { text: agg.richness.mean.toFixed(1) }),
          el('td', { text: agg.shannon.mean.toFixed(3) }),
          el('td', { text: agg.simpson.mean.toFixed(3) }),
        ])
      );
    }
    divTable.appendChild(divBody);
    section.appendChild(el('div', { className: 'table-wrap scroll-panel' }, [divTable]));
    const diversityCsvBtn = el('button', { className: 'act', type: 'button', text: 'Export diversity summary as CSV' });
    diversityCsvBtn.addEventListener('click', () => {
      downloadTextFile(`diversity-summary-${comparisonRank}.csv`, diversitySummaryToCsv(diversitySummary));
    });
    section.appendChild(el('div', { className: 'diagram-export-row' }, [diversityCsvBtn]));

    // Sample similarity
    section.appendChild(el('h4', { text: 'Sample similarity' }));
    const metricRow = el('div', { className: 'topn-controls' });
    const metricSelect = el('select');
    [
      ['bray-curtis', 'Bray-Curtis (abundance)'],
      ['jaccard', 'Jaccard (presence/absence)'],
    ].forEach(([value, label]) => {
      const opt = el('option', { value, text: label });
      opt.selected = value === similarityMetric;
      metricSelect.appendChild(opt);
    });
    metricSelect.addEventListener('change', () => {
      similarityMetric = metricSelect.value;
      renderResults();
    });
    metricRow.appendChild(el('label', { text: 'Distance metric: ' }));
    metricRow.appendChild(metricSelect);
    section.appendChild(metricRow);

    const distance = computeDistanceMatrix(run.tree, sampleIds, comparisonRank, similarityMetric, {
      minAbundance: presenceThreshold,
      filters: currentFilters(),
    });
    const similarityHost = el('div', { className: 'heatmap-host scroll-panel' });
    section.appendChild(similarityHost);
    const labels = sampleIds.map(sampleGroupLabelFn(included));
    renderHeatmapSVG(similarityHost, {
      rowLabels: labels,
      colLabels: labels,
      matrix: distance.matrix,
      colorFn: (v, mn, mx) => sequentialColor(mn + mx - v, mn, mx), // invert: 0 distance (identical) reads strongest
      colGroupColors,
      cellWidth: 22,
      cellHeight: 16,
    });
    section.appendChild(createExportButtons(() => similarityHost, `similarity-${similarityMetric}`));
    const similarityCsvBtn = el('button', { className: 'act', type: 'button', text: 'Export distance matrix as CSV' });
    similarityCsvBtn.addEventListener('click', () => {
      downloadTextFile(`similarity-${similarityMetric}-${comparisonRank}.csv`, distanceMatrixToCsv(distance));
    });
    section.appendChild(el('div', { className: 'diagram-export-row' }, [similarityCsvBtn]));

    // MicrobiomeAnalyst export — brought forward from Phase 9 and tied
    // directly to this section's current state: the same included
    // samples, the same rank, the same global filters (exclusion list +
    // abundance threshold), and the current group assignments. Built to
    // spec exactly (see src/model/microbiome-analyst-export.js) as the
    // primary structured export; nothing here re-derives its own idea of
    // "current" — it reads the exact same sampleIds/comparisonRank/
    // currentFilters()/samplesWithGroup this section already computed.
    section.appendChild(el('h4', { text: 'Export for MicrobiomeAnalyst' }));
    section.appendChild(
      el('p', {
        className: 'hint',
        text: 'Three files built to the MicrobiomeAnalyst data format, reflecting exactly the samples, rank, and filters currently shown above (excluded samples and filtered-out taxa are not included).',
      })
    );

    const exportResult = buildMicrobiomeAnalystExport(run.tree, sampleIds, comparisonRank, samplesWithGroup, {
      filters: currentFilters(),
    });

    if (exportResult.warnings.length > 0) {
      const warningBox = el('div', { className: 'export-warnings' });
      exportResult.warnings.forEach((w) => warningBox.appendChild(el('p', { text: `⚠ ${w}` })));
      section.appendChild(warningBox);
    }

    if (exportResult.sanitizationChanges.length > 0) {
      const details = el('details', { className: 'provenance-details' });
      details.appendChild(
        el('summary', { text: `${exportResult.sanitizationChanges.length} label(s) auto-converted to satisfy the spec's naming rules` })
      );
      const list = el('ul', {});
      exportResult.sanitizationChanges.forEach((c) => {
        list.appendChild(el('li', { text: `"${c.original}" → "${c.sanitized}"` }));
      });
      details.appendChild(list);
      section.appendChild(details);
    }

    section.appendChild(
      el('p', {
        className: 'row-count',
        text: `${exportResult.taxonCount} taxa × ${exportResult.sampleCount} samples at rank ${comparisonRank}.`,
      })
    );

    const downloadRow = el('div', { className: 'export-download-row' });
    const files = [
      ['abundance_table.txt', exportResult.abundanceTableText, 'Abundance table'],
      ['taxonomy_mapping.txt', exportResult.taxonomyMappingText, 'Taxonomy mapping'],
      ['metadata.txt', exportResult.metadataText, 'Metadata'],
    ];
    files.forEach(([filename, text, label]) => {
      const btn = el('button', { type: 'button', className: 'act', text: `Download ${label}` });
      btn.addEventListener('click', () => downloadTextFile(filename, text));
      downloadRow.appendChild(btn);
    });
    section.appendChild(downloadRow);

    return section;
  }

  function renderResults() {
    // The four collapsible sidebar sections are always present (matching
    // Pangenome Explorer's shell) — each renders its own "load a run
    // first" hint when empty, rather than the whole section disappearing.
    const groupsBody = document.getElementById('groupsSectionBody');
    groupsBody.innerHTML = '';
    groupsBody.appendChild(renderGroupsSection());

    const filtersBody = document.getElementById('filtersSectionBody');
    filtersBody.innerHTML = '';
    filtersBody.appendChild(renderFiltersSection());

    const tagsBody = document.getElementById('tagsSectionBody');
    tagsBody.innerHTML = '';
    tagsBody.appendChild(renderTaxonTagsSection());

    const metadataBody = document.getElementById('metadataSectionBody');
    metadataBody.innerHTML = '';
    metadataBody.appendChild(renderSampleMetadataSection());

    if (run.samples.size === 0) {
      explorerEl.style.display = 'none';
      emptyEl.style.display = '';
      hTitle.textContent = '';
      hMeta.textContent = '';
      return;
    }
    explorerEl.style.display = '';
    emptyEl.style.display = 'none';
    hTitle.textContent = `${run.samples.size} sample${run.samples.size === 1 ? '' : 's'}`;

    explorerEl.innerHTML = '';

    const overviewSection = renderOverviewDashboard();
    const comparisonSection = renderComparisonSection();
    // Only worth a divider when there's cross-sample content to separate
    // from the single-sample content below it — with one sample loaded,
    // there's nothing to distinguish and the banner would just be noise.
    const hasCrossSampleContent = Boolean(overviewSection || comparisonSection);
    if (hasCrossSampleContent) {
      explorerEl.appendChild(renderSectionBanner('Cross-sample overview', `${run.samples.size} samples loaded`));
    }
    if (overviewSection) explorerEl.appendChild(overviewSection);
    if (comparisonSection) explorerEl.appendChild(comparisonSection);

    const selector = renderSampleSelector();

    const sample = run.samples.get(activeSampleId);
    hMeta.textContent = `active: ${sample.id}`;
    if (hasCrossSampleContent) {
      explorerEl.appendChild(renderSectionBanner('Individual sample', sampleLabelWithGroup(sample)));
    }
    if (selector) explorerEl.appendChild(selector);
    explorerEl.appendChild(renderSummaryCard(sample));

    if (sample.kind !== 'generic') {
      const sunburstSection = renderSunburstSection(sample);
      if (sunburstSection) explorerEl.appendChild(sunburstSection);

      const sankeySection = renderSankeySection(sample);
      if (sankeySection) explorerEl.appendChild(sankeySection);

      const rankControls = renderRankControls(sample);
      if (rankControls) explorerEl.appendChild(rankControls);
    }
    explorerEl.appendChild(renderSearchBox());
    explorerEl.appendChild(el('div', { id: 'topn-chart-host' }));
    explorerEl.appendChild(el('div', { id: 'rank-table-host' }));

    if (sample.kind !== 'generic') {
      const csvBtn = el('button', { type: 'button', className: 'act', text: 'Export table as CSV' });
      csvBtn.addEventListener('click', () => {
        const csv = rankTableToCsv(getTableRows(sample), sample.id, sample.group);
        downloadTextFile(`${sample.id}-rank-table.csv`, csv);
      });
      explorerEl.appendChild(el('div', { className: 'diagram-export-row' }, [csvBtn]));
    }

    renderTableAndChart();
  }

  // ---- Theme toggle: light <-> dark (shell-level, active before load) --
  const themeBtn = document.getElementById('themeBtn');
  const THEME_KEY = 'clann-edna-theme';

  const storedTheme = localStorage.getItem(THEME_KEY);
  if (storedTheme === 'light' || storedTheme === 'dark') {
    document.documentElement.dataset.theme = storedTheme;
  }
  themeBtn.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  });

  // ---- Confirm before leaving once a run is loaded ---------------------
  // Nothing is persisted anywhere (by design — see the About section), so
  // a reload or back-navigation silently wipes every loaded sample, group
  // assignment, filter, and tag. Only warn once there's actually something
  // to lose; setting/clearing returnValue on every render would be wasted
  // work and the browser only needs it set at unload time anyway.
  window.addEventListener('beforeunload', (e) => {
    if (run.samples.size === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();
