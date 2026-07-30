(function () {
  'use strict';

  const { sniffFormat } = window.ClannEDNA.sniff;
  const { filesFromWebkitDirectoryInput, supportsFileSystemAccess, pickFolderFileSystemAccess } =
    window.ClannEDNA.folderLoader;
  const { buildSample, guessSampleIdFromFilename } = window.ClannEDNA.sample;
  const { computeSampleSummary } = window.ClannEDNA.summary;
  const { RANK_ORDER, computeAvailableRanks, computeRankTable, computeGenericTable, sortRows, computeTopN } =
    window.ClannEDNA.rankTable;
  const { TaxonomyTree } = window.ClannEDNA.taxonomyTree;
  const { parseBreport } = window.ClannEDNA.breport;
  const { parseBracken } = window.ClannEDNA.bracken;
  const { parseGeneric } = window.ClannEDNA.generic;
  const { captureProvenance } = window.ClannEDNA.provenance;
  const { buildHierarchyTree } = window.ClannEDNA.hierarchy;
  const { renderSunburstSVG } = window.ClannEDNA.sunburst;
  const { computeSankeyData, computeSankeyLayout, renderSankeySVG } = window.ClannEDNA.sankey;
  const { EXCLUDE, parseGroupNames, resolveSampleGroup, summarizeGroups } = window.ClannEDNA.groups;
  const { computeDiversity, computeDiversitySummary } = window.ClannEDNA.diversity;
  const { buildAbundanceMatrix, toPresenceAbsence, computeStackedComposition } = window.ClannEDNA.comparison;
  const { computeDistanceMatrix } = window.ClannEDNA.similarity;
  const { renderHeatmapSVG, sequentialColor, binaryColor } = window.ClannEDNA.heatmap;
  const { renderStackedBarSVG } = window.ClannEDNA.stackedBar;
  const { parseExclusionList, matchesSearch } = window.ClannEDNA.filters;
  const parsers = { parseBreport, parseBracken, parseGeneric, captureProvenance };

  const folderInput = document.getElementById('folder-input');
  const pickFolderBtn = document.getElementById('pick-folder-btn');
  const tickList = document.getElementById('file-ticklist');
  const emptyState = document.getElementById('load-empty-state');
  const loadBtn = document.getElementById('load-selected-btn');
  const resultsPanel = document.getElementById('results-panel');

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
    if (result.format === 'generic') return result.confidence === 'unconfirmed' ? 'generic (unconfirmed)' : 'generic';
    return 'not recognised';
  }

  // ---- Tick-list ----------------------------------------------------

  let currentResults = []; // [{file, format, confidence, reason?, candidateNameColumn?, candidateAbundanceColumn?}]

  function renderTickList(results) {
    currentResults = results;
    tickList.innerHTML = '';
    emptyState.style.display = results.length === 0 ? 'block' : 'none';
    loadBtn.style.display = results.some((r) => r.format !== 'unknown') ? 'inline-block' : 'none';

    results.forEach((result, index) => {
      const li = document.createElement('li');
      const usable = result.format !== 'unknown';
      li.dataset.disabled = String(!usable);
      li.dataset.index = String(index);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = usable && result.confidence === 'high';
      checkbox.disabled = !usable;
      checkbox.className = 'row-checkbox';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'sample-name-input';
      nameInput.value = guessSampleIdFromFilename(result.file.name);
      nameInput.title = 'Sample name — files sharing this name are merged into one sample';
      nameInput.disabled = !usable;

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

      tickList.appendChild(li);
    });
  }

  async function handleFiles(files) {
    const results = await Promise.all(files.map(sniffFile));
    renderTickList(results);
  }

  if (supportsFileSystemAccess()) {
    pickFolderBtn.style.display = 'inline-block';
    folderInput.style.display = 'none';
    pickFolderBtn.addEventListener('click', async () => {
      try {
        const files = await pickFolderFileSystemAccess();
        await handleFiles(files);
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
      }
    });
  } else {
    pickFolderBtn.style.display = 'none';
    folderInput.style.display = 'inline-block';
    folderInput.addEventListener('change', async (event) => {
      const files = filesFromWebkitDirectoryInput(event.target.files);
      await handleFiles(files);
    });
  }

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

  function currentFilters() {
    return {
      exclusionTerms: parseExclusionList(exclusionListText),
      minAbundance: { mode: minAbundanceMode, value: minAbundanceValue },
    };
  }

  async function loadSelected() {
    const rows = Array.from(tickList.querySelectorAll('li'));
    const grouped = new Map(); // sampleName -> {breport?, bracken?, generic?}

    for (const li of rows) {
      const checkbox = li.querySelector('.row-checkbox');
      if (!checkbox || !checkbox.checked) continue;
      const index = Number(li.dataset.index);
      const result = currentResults[index];
      const sampleName = li.querySelector('.sample-name-input').value.trim();
      if (!sampleName) continue;

      if (!grouped.has(sampleName)) grouped.set(sampleName, {});
      const bucket = grouped.get(sampleName);
      const text = await result.file.text();

      if (result.format === 'breport') {
        bucket.breport = { text, filename: result.file.name };
      } else if (result.format === 'bracken') {
        bucket.bracken = { text, filename: result.file.name };
      } else if (result.format === 'generic') {
        const nameColumn = Number(li.querySelector('.name-col-input').value);
        const abundanceColumn = Number(li.querySelector('.abundance-col-input').value);
        bucket.generic = { text, filename: result.file.name, mapping: { nameColumn, abundanceColumn } };
      }
    }

    if (grouped.size === 0) {
      alert('Tick at least one recognised file, and give it a sample name, before loading.');
      return;
    }

    for (const [sampleId, inputs] of grouped) {
      const sample = buildSample(sampleId, inputs, run.tree, parsers);
      run.samples.set(sampleId, sample);
    }

    activeSampleId = activeSampleId && run.samples.has(activeSampleId) ? activeSampleId : grouped.keys().next().value;
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
    if (run.samples.size < 2) return null; // brief: no grouping UI for a single sample

    const section = el('div', { className: 'viz-section groups-section' });
    section.appendChild(el('h3', { text: 'Sample groups' }));
    section.appendChild(
      el('p', {
        className: 'viz-breadcrumb',
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
      li.appendChild(el('span', { className: 'sample-group-name', text: sample.id }));

      const select = el('select');
      select.appendChild(el('option', { value: '', text: '— unassigned —' }));
      groupNames.forEach((g) => select.appendChild(el('option', { value: g, text: g })));
      select.appendChild(el('option', { value: EXCLUDE, text: EXCLUDE }));
      select.value = sample.group && (groupNames.includes(sample.group) || sample.group === EXCLUDE) ? sample.group : '';

      select.addEventListener('change', () => {
        sample.group = select.value || null;
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
    if (run.samples.size === 0) return null;
    const section = el('div', { className: 'viz-section filters-section' });
    section.appendChild(el('h3', { text: 'Filters & search' }));

    // Host/contaminant exclusion list
    section.appendChild(
      el('p', {
        className: 'viz-breadcrumb',
        text: 'Exclude known host/contaminant taxa (exact name or taxid, comma or newline separated) — removed from every view and every calculation, with the rest renormalized to 100%.',
      })
    );
    const exclusionInput = el('textarea', {
      id: 'exclusion-list-input',
      rows: '2',
      placeholder: 'e.g. Homo sapiens, Bos taurus',
    });
    exclusionInput.value = exclusionListText;
    focusPreservingInput(exclusionInput, 'exclusion-list-input', (v) => {
      exclusionListText = v;
    });
    section.appendChild(exclusionInput);

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
    const resetBtn = el('button', { type: 'button', text: 'Reset' });
    resetBtn.addEventListener('click', () => {
      minAbundanceValue = 0;
      minAbundanceMode = 'pct';
      renderResults();
    });
    thresholdRow.appendChild(valueInput);
    thresholdRow.appendChild(modeSelect);
    thresholdRow.appendChild(resetBtn);
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
    const card = el('div', { className: 'summary-card' });
    card.appendChild(el('h3', { text: sample.displayName }));

    if (sample.kind === 'generic') {
      card.appendChild(
        el('p', { text: `Generic format — ${sample.genericRows.length} rows, no taxonomic hierarchy available.` })
      );
      return card;
    }

    const summary = computeSampleSummary(run.tree, sample.id);
    const stats = el('dl', { className: 'stat-grid' });
    const addStat = (label, value) => {
      stats.appendChild(el('dt', { text: label }));
      stats.appendChild(el('dd', { text: value }));
    };
    addStat('Total reads', summary.totalReads.toLocaleString());
    addStat('Classified', `${summary.classifiedReads.toLocaleString()} (${summary.classifiedPct.toFixed(2)}%)`);
    addStat('Unclassified', summary.unclassifiedReads.toLocaleString());
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
    sorted.forEach((row) => {
      const tr = el('tr', {}, [
        el('td', { text: row.name }),
        el('td', { text: row.cladeReads.toLocaleString() }),
        el('td', { text: `${row.pctOfTotal.toFixed(3)}%` }),
      ]);
      if (matchesSearch(row.name, row.taxid, globalSearchText)) tr.classList.add('search-match');
      tbody.appendChild(tr);
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

    const addBar = (label, reads, pct, cls, taxid) => {
      const highlighted = matchesSearch(label, taxid, globalSearchText);
      const barRow = el('div', { className: `bar-row ${cls || ''} ${highlighted ? 'search-match' : ''}` });
      barRow.appendChild(el('span', { className: 'bar-label', text: label }));
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
    const hierarchyRoot = buildHierarchyTree(run.tree, sample.id);
    if (!hierarchyRoot) return null;

    const section = el('div', { className: 'viz-section' });
    section.appendChild(el('h3', { text: 'Taxonomic sunburst' }));
    const breadcrumb = el('p', { className: 'viz-breadcrumb', text: 'root — click a segment to zoom in, click the centre to zoom out' });
    section.appendChild(breadcrumb);
    const host = el('div', { className: 'sunburst-host' });
    section.appendChild(host);

    renderSunburstSVG(host, hierarchyRoot, {
      size: 460,
      isHighlighted: (name, taxid) => matchesSearch(name, taxid, globalSearchText),
      onFocusChange: (focus) => {
        breadcrumb.textContent =
          focus.depth <= 0
            ? 'root — click a segment to zoom in, click the centre to zoom out'
            : `${focus.name} (${focus.cladeReads.toLocaleString()} reads) — click a segment to zoom in, click the centre to zoom out`;
      },
    });

    return section;
  }

  // ---- Sankey (Pavian-style) --------------------------------------------

  let sankeyStartRank = null;
  let sankeyEndRank = null;

  function renderSankeySection(sample) {
    const ranks = computeAvailableRanks(run.tree, sample.id);
    if (ranks.length < 2) return null;

    if (!sankeyStartRank || !ranks.includes(sankeyStartRank)) sankeyStartRank = ranks[0];
    if (!sankeyEndRank || !ranks.includes(sankeyEndRank)) sankeyEndRank = ranks[ranks.length - 1];

    const section = el('div', { className: 'viz-section' });
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
    section.appendChild(controls);

    const host = el('div', { className: 'sankey-host' });
    section.appendChild(host);

    function draw() {
      const startIdx = ranks.indexOf(sankeyStartRank);
      const endIdx = ranks.indexOf(sankeyEndRank);
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const rankRange = ranks.slice(lo, hi + 1);
      if (rankRange.length < 2) {
        host.innerHTML = '';
        host.appendChild(el('p', { className: 'empty-state', text: 'Pick two different ranks to draw a flow diagram.' }));
        return;
      }
      const data = computeSankeyData(run.tree, sample.id, rankRange);
      const width = Math.max(600, host.clientWidth || 700);
      const layout = computeSankeyLayout(data, { width, height: 420 });
      renderSankeySVG(host, layout, { width, height: 420, isHighlighted: (name, taxid) => matchesSearch(name, taxid, globalSearchText) });
    }

    startSelect.addEventListener('change', () => {
      sankeyStartRank = startSelect.value;
      draw();
    });
    endSelect.addEventListener('change', () => {
      sankeyEndRank = endSelect.value;
      draw();
    });

    draw();
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
    const section = el('div', { className: 'viz-section overview-dashboard' });
    section.appendChild(el('h3', { text: 'Overview' }));

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

    const statsTable = el('table', { className: 'overview-stats-table' });
    const headRow = el('tr', {}, ['Group', 'n', 'Total reads (mean, range)', 'Classified % (mean, range)'].map((h) => el('th', { text: h })));
    statsTable.appendChild(el('thead', {}, [headRow]));
    const tbody = el('tbody');
    buckets.forEach((bucket) => {
      const stats = bucket.ids
        .map((id) => run.samples.get(id))
        .filter((s) => s && s.kind !== 'generic')
        .map((s) => computeSampleSummary(run.tree, s.id));
      if (stats.length === 0) return;
      const totals = stats.map((s) => s.totalReads);
      const pcts = stats.map((s) => s.classifiedPct);
      const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      tbody.appendChild(
        el('tr', {}, [
          el('td', { text: bucket.label }),
          el('td', { text: String(stats.length) }),
          el('td', { text: `${Math.round(mean(totals)).toLocaleString()} (${Math.min(...totals).toLocaleString()}–${Math.max(...totals).toLocaleString()})` }),
          el('td', { text: `${mean(pcts).toFixed(1)}% (${Math.min(...pcts).toFixed(1)}–${Math.max(...pcts).toFixed(1)}%)` }),
        ])
      );
    });
    statsTable.appendChild(tbody);
    section.appendChild(statsTable);

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
    }

    return section;
  }

  function renderDiversityPlot(diversitySummary, metric, groupNames) {
    const container = el('div', { className: 'diversity-plot' });
    const allValues = diversitySummary.perSample.map((s) => s[metric]);
    const min = Math.min(...allValues, 0);
    const max = Math.max(...allValues, 1e-9);
    const scale = (v) => (max > min ? ((v - min) / (max - min)) * 100 : 50);

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

    const section = el('div', { className: 'viz-section comparison-section' });
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

    const stackedHost = el('div', { className: 'stacked-bar-host' });
    section.appendChild(stackedHost);
    const stackedData = computeStackedComposition(run.tree, sampleIds, comparisonRank, stackedBarTopN, currentFilters());
    renderStackedBarSVG(stackedHost, stackedData, {
      sampleLabels: sampleGroupLabelFn(included),
      isTaxonHighlighted: (name) => matchesSearch(name, null, globalSearchText),
    });

    // Abundance heatmap
    section.appendChild(el('h4', { text: 'Abundance heatmap' }));
    const abundanceMatrix = buildAbundanceMatrix(run.tree, sampleIds, comparisonRank, { filters: currentFilters() });
    const cappedAbundance = {
      ...abundanceMatrix,
      taxa: abundanceMatrix.taxa.slice(0, heatmapMaxRows),
      matrix: abundanceMatrix.matrix.slice(0, heatmapMaxRows),
    };
    section.appendChild(
      el('p', {
        className: 'row-count',
        text: `Showing top ${Math.min(heatmapMaxRows, abundanceMatrix.taxa.length)} of ${abundanceMatrix.taxa.length} taxa by total abundance.`,
      })
    );
    const heatmapHost = el('div', { className: 'heatmap-host scroll-panel' });
    section.appendChild(heatmapHost);
    renderHeatmapSVG(heatmapHost, {
      rowLabels: cappedAbundance.taxa.map((t) => t.name),
      colLabels: sampleIds.map(sampleGroupLabelFn(included)),
      matrix: cappedAbundance.matrix,
      colGroupColors,
      isRowHighlighted: (name) => matchesSearch(name, null, globalSearchText),
    });

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

    const presenceAbsence = toPresenceAbsence(cappedAbundance, presenceThreshold);
    const presenceHost = el('div', { className: 'heatmap-host scroll-panel' });
    section.appendChild(presenceHost);
    renderHeatmapSVG(presenceHost, {
      rowLabels: presenceAbsence.taxa.map((t) => t.name),
      colLabels: sampleIds.map(sampleGroupLabelFn(included)),
      matrix: presenceAbsence.matrix,
      colorFn: binaryColor,
      colGroupColors,
      isRowHighlighted: (name) => matchesSearch(name, null, globalSearchText),
    });

    // Small multiples sunburst
    section.appendChild(el('h4', { text: 'Community structure (small multiples)' }));
    const smallMultiples = el('div', { className: 'small-multiples' });
    section.appendChild(smallMultiples);
    included.forEach((sample) => {
      const hierarchyRoot = buildHierarchyTree(run.tree, sample.id);
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
        isHighlighted: (name, taxid) => matchesSearch(name, taxid, globalSearchText),
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

    return section;
  }

  function renderResults() {
    if (run.samples.size === 0) return;
    resultsPanel.innerHTML = '';
    resultsPanel.appendChild(el('h2', { text: 'Results' }));

    const groupsSection = renderGroupsSection();
    if (groupsSection) resultsPanel.appendChild(groupsSection);

    const filtersSection = renderFiltersSection();
    if (filtersSection) resultsPanel.appendChild(filtersSection);

    const overviewSection = renderOverviewDashboard();
    if (overviewSection) resultsPanel.appendChild(overviewSection);

    const comparisonSection = renderComparisonSection();
    if (comparisonSection) resultsPanel.appendChild(comparisonSection);

    const selector = renderSampleSelector();
    if (selector) resultsPanel.appendChild(selector);

    const sample = run.samples.get(activeSampleId);
    resultsPanel.appendChild(renderSummaryCard(sample));

    if (sample.kind !== 'generic') {
      const sunburstSection = renderSunburstSection(sample);
      if (sunburstSection) resultsPanel.appendChild(sunburstSection);

      const sankeySection = renderSankeySection(sample);
      if (sankeySection) resultsPanel.appendChild(sankeySection);

      const rankControls = renderRankControls(sample);
      if (rankControls) resultsPanel.appendChild(rankControls);
    }
    resultsPanel.appendChild(renderSearchBox());
    resultsPanel.appendChild(el('div', { id: 'topn-chart-host' }));
    resultsPanel.appendChild(el('div', { id: 'rank-table-host' }));

    renderTableAndChart();
  }

  // ---- Theme toggle: cycles system -> light -> dark -> system --------
  const themeToggle = document.getElementById('theme-toggle');
  const THEME_KEY = 'clann-edna-theme';

  function applyTheme(theme) {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    themeToggle.textContent = theme === 'system' ? 'Theme: Auto' : theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';
  }

  function nextTheme(current) {
    if (current === 'system') return 'light';
    if (current === 'light') return 'dark';
    return 'system';
  }

  let currentTheme = localStorage.getItem(THEME_KEY) || 'system';
  applyTheme(currentTheme);
  themeToggle.addEventListener('click', () => {
    currentTheme = nextTheme(currentTheme);
    localStorage.setItem(THEME_KEY, currentTheme);
    applyTheme(currentTheme);
  });
})();
