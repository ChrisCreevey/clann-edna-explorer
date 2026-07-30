// Folder-based loading (PLAN.md §1 "Folder-based loading"). Feature-detects
// the File System Access API (Chromium) and falls back to a plain
// <input type="file" webkitdirectory"> element everywhere else. Both paths
// resolve to the same flat list of File objects for the caller to sniff.

function supportsFileSystemAccess() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

async function collectFilesFromDirectoryHandle(dirHandle, files = []) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      files.push(await entry.getFile());
    } else if (entry.kind === 'directory') {
      await collectFilesFromDirectoryHandle(entry, files);
    }
  }
  return files;
}

/**
 * Opens the native directory picker (Chromium only) and returns a flat
 * array of File objects found inside it (recursing into subfolders).
 */
async function pickFolderFileSystemAccess() {
  const dirHandle = await window.showDirectoryPicker();
  return collectFilesFromDirectoryHandle(dirHandle);
}

/**
 * Converts a FileList from a `webkitdirectory` <input> change event into a
 * flat array of File objects (already flat — webkitdirectory reports
 * relative paths via webkitRelativePath but the FileList itself is flat).
 */
function filesFromWebkitDirectoryInput(fileList) {
  return Array.from(fileList);
}

const folderLoaderExports = {
  supportsFileSystemAccess,
  pickFolderFileSystemAccess,
  filesFromWebkitDirectoryInput,
};
if (typeof module !== 'undefined' && module.exports) module.exports = folderLoaderExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.folderLoader = folderLoaderExports;
}
