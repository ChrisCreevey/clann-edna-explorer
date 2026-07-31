(function () {
  'use strict';

// Multi-file loading. Previously offered a folder picker (the File System
// Access API's showDirectoryPicker on Chromium, falling back to a plain
// <input webkitdirectory> elsewhere) but that meant genuinely different UX
// depending on the browser — Chromium's native directory dialog can look
// enough like a normal file-open dialog to read as "expecting me to pick a
// file" (it isn't; only a folder confirms), and the two paths could behave
// differently under browser policies that block the File System Access
// API. A plain multi-file <input type="file" multiple> behaves identically
// everywhere and needs no feature detection: the user select-all's (or
// shift/cmd-clicks) every .breport/.bracken file for a run in one go.

/**
 * Converts a FileList from a multi-file <input> change event into a flat
 * array of File objects.
 */
function filesFromFileInput(fileList) {
  return Array.from(fileList);
}

const folderLoaderExports = {
  filesFromFileInput,
};
if (typeof module !== 'undefined' && module.exports) module.exports = folderLoaderExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.folderLoader = folderLoaderExports;
}
})();
