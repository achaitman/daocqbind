// Preload script — runs in the renderer's context but with access to Node's IPC.
// We expose a safe, narrow API surface as window.api so the renderer can't touch
// the filesystem or process directly.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Initial state on load
  getInitialState: () => ipcRenderer.invoke("fs:get-initial-state"),

  // Folder operations
  pickFolder: () => ipcRenderer.invoke("fs:pick-folder"),
  listFolder: (folderPath) => ipcRenderer.invoke("fs:list-folder", folderPath),
  revealFolder: (folderPath) => ipcRenderer.invoke("fs:reveal-folder", folderPath),

  // File operations
  readFile: (fullPath) => ipcRenderer.invoke("fs:read-file", fullPath),
  writeFile: (fullPath, text, createBackup) =>
    ipcRenderer.invoke("fs:write-file", { fullPath, text, createBackup }),
  deleteFile: (fullPath) => ipcRenderer.invoke("fs:delete-file", fullPath),
  renameFile: (fromPath, toPath, overwrite) =>
    ipcRenderer.invoke("fs:rename-file", { fromPath, toPath, overwrite }),

  // Native dialogs
  showSaveDialog: (defaultName, content) =>
    ipcRenderer.invoke("fs:show-save-dialog", { defaultName, content }),
  showOpenDialog: () => ipcRenderer.invoke("fs:show-open-dialog"),
  confirm: (opts) => ipcRenderer.invoke("ui:confirm", opts),

  // Events from main → renderer
  onDaocStatusChanged: (handler) => {
    ipcRenderer.on("daoc:status-changed", (_event, data) => handler(data));
  },
  onMenuChangeFolder: (handler) => {
    ipcRenderer.on("menu:change-folder", () => handler());
  },
  onMenuReloadFolder: (handler) => {
    ipcRenderer.on("menu:reload-folder", () => handler());
  },

  // Path utilities
  pathJoin: (...parts) => parts.join(/\\|\//.test(parts[0] || "") ? "\\" : "/"),
});
