(function () {
  'use strict';

  const { sniffFormat } = window.ClannEDNA.sniff;
  const { filesFromWebkitDirectoryInput, supportsFileSystemAccess, pickFolderFileSystemAccess } =
    window.ClannEDNA.folderLoader;

  const folderInput = document.getElementById('folder-input');
  const pickFolderBtn = document.getElementById('pick-folder-btn');
  const tickList = document.getElementById('file-ticklist');
  const emptyState = document.getElementById('load-empty-state');

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

  function renderTickList(results) {
    tickList.innerHTML = '';
    emptyState.style.display = results.length === 0 ? 'block' : 'none';

    for (const result of results) {
      const li = document.createElement('li');
      const usable = result.format !== 'unknown';
      li.dataset.disabled = String(!usable);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = usable && result.confidence === 'high';
      checkbox.disabled = !usable;
      checkbox.dataset.filename = result.file.name;

      const name = document.createElement('span');
      name.textContent = result.file.name;
      name.style.flex = '1';

      const label = document.createElement('span');
      label.className = 'format-label';
      label.textContent = formatLabel(result);

      li.appendChild(checkbox);
      li.appendChild(name);
      li.appendChild(label);

      if (!usable || result.confidence === 'unconfirmed') {
        const reason = document.createElement('span');
        reason.className = 'reason';
        reason.textContent = result.reason || '';
        li.appendChild(reason);
      }

      tickList.appendChild(li);
    }
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

  // Theme toggle: cycles system -> light -> dark -> system.
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
