(function () {
  'use strict';

  const { sniffFormat } = window.ClannEDNA.sniff;
  const { filesFromWebkitDirectoryInput, supportsFileSystemAccess, pickFolderFileSystemAccess } =
    window.ClannEDNA.folderLoader;
  const { buildSample, guessSampleIdFromFilename } = window.ClannEDNA.sample;
  const { computeSampleSummary } = window.ClannEDNA.summary;
  const { computeAvailableRanks, computeRankTable, computeGenericTable, sortRows, computeTopN } =
    window.ClannEDNA.rankTable;
  const { TaxonomyTree } = window.ClannEDNA.taxonomyTree;
  const { parseBreport } = window.ClannEDNA.breport;
  const { parseBracken } = window.ClannEDNA.bracken;
  const { parseGeneric } = window.ClannEDNA.generic;
  const { captureProvenance } = window.ClannEDNA.provenance;
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

  function renderSampleSelector() {
    const ids = [...run.samples.keys()];
    if (ids.length <= 1) return null;
    const select = el('select', { id: 'sample-selector' });
    ids.forEach((id) => {
      const opt = el('option', { value: id, text: id });
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
    return computeRankTable(run.tree, sample.id, currentRank, currentSearch);
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
      tbody.appendChild(
        el('tr', {}, [
          el('td', { text: row.name }),
          el('td', { text: row.cladeReads.toLocaleString() }),
          el('td', { text: `${row.pctOfTotal.toFixed(3)}%` }),
        ])
      );
    });
    table.appendChild(tbody);

    return el('div', { className: 'table-wrap' }, [
      el('p', { className: 'row-count', text: `${rows.length} taxa` }),
      table,
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
    const bars = el('div', { className: 'bar-list' });

    const addBar = (label, reads, pct, cls) => {
      const barRow = el('div', { className: `bar-row ${cls || ''}` });
      barRow.appendChild(el('span', { className: 'bar-label', text: label }));
      const track = el('div', { className: 'bar-track' });
      const fill = el('div', { className: 'bar-fill' });
      fill.style.width = `${maxReads > 0 ? (100 * reads) / maxReads : 0}%`;
      track.appendChild(fill);
      barRow.appendChild(track);
      barRow.appendChild(el('span', { className: 'bar-value', text: `${reads.toLocaleString()} (${pct.toFixed(2)}%)` }));
      bars.appendChild(barRow);
    };

    top.forEach((row) => addBar(row.name, row.cladeReads, row.pctOfTotal));
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

  function renderResults() {
    if (run.samples.size === 0) return;
    resultsPanel.innerHTML = '';
    resultsPanel.appendChild(el('h2', { text: 'Results' }));

    const selector = renderSampleSelector();
    if (selector) resultsPanel.appendChild(selector);

    const sample = run.samples.get(activeSampleId);
    resultsPanel.appendChild(renderSummaryCard(sample));

    if (sample.kind !== 'generic') {
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
