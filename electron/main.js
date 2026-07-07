// Main process: creates the window, owns the filesystem, exposes IPC to the renderer.
// All filesystem and process-detection work happens here. The renderer never touches the OS directly.

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const fssync = require("fs");
const { exec } = require("child_process");
const { findEdenFolder, looksLikeEdenFolder, getDefaultEdenPath } = require("./eden-finder");

// electron-updater is optional at runtime; guard so the app still boots if
// it's somehow unavailable (e.g. an unpackaged/partial build).
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch (_) {
  autoUpdater = null;
}

const UPDATE_REPO = { owner: "achaitman", repo: "daocqbind" };

// ---- Settings persistence ----
// We keep a tiny JSON file in userData with the chosen eden folder path.
const SETTINGS_PATH = () => path.join(app.getPath("userData"), "settings.json");

async function loadSettings() {
  try {
    const text = await fs.readFile(SETTINGS_PATH(), "utf8");
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
}

async function saveSettings(s) {
  try {
    await fs.mkdir(path.dirname(SETTINGS_PATH()), { recursive: true });
    await fs.writeFile(SETTINGS_PATH(), JSON.stringify(s, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// ---- Window ----
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "DAoC Qbind Editor",
    backgroundColor: "#1a1a1a",
    frame: false,          // custom in-app title bar (see renderer titlebar)
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Frameless window: tell the renderer when maximize state changes so the
  // custom title bar can swap the maximize/restore glyph.
  mainWindow.on("maximize", () => mainWindow.webContents.send("win:maximized-changed", true));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("win:maximized-changed", false));

  // Build a minimal app menu
  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "Change eden folder…",
          click: async () => {
            mainWindow.webContents.send("menu:change-folder");
          },
        },
        {
          label: "Reload folder",
          accelerator: "F5",
          click: () => {
            mainWindow.webContents.send("menu:reload-folder");
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About",
              message: "DAoC Qbind Editor",
              detail: `Version ${app.getVersion()}\n\nVisual editor for Dark Age of Camelot quickbar key bindings.\n\nBuilt with Electron.`,
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Start polling for DAoC running every 5s once the window is ready
  mainWindow.webContents.on("did-finish-load", () => {
    pollDaocRunning();
    // Give the renderer a moment to register its updater listener, then check.
    setTimeout(initUpdater, 2500);
  });
}

// ---- IPC: frameless window controls ----

ipcMain.on("win:minimize", () => mainWindow && mainWindow.minimize());
ipcMain.on("win:maximize-toggle", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("win:close", () => mainWindow && mainWindow.close());
ipcMain.handle("win:is-maximized", () => !!(mainWindow && mainWindow.isMaximized()));

ipcMain.handle("ui:about", () => {
  if (!mainWindow) return;
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "About",
    message: "DAoC Qbind Editor",
    detail: `Version ${app.getVersion()}\n\nVisual editor for Dark Age of Camelot quickbar key bindings.\n\nBuilt with Electron.`,
    buttons: ["OK"],
  });
});

// ---- Auto-update ----
// Installed (NSIS) builds use electron-updater for a full download+install+
// restart. Portable builds and dev can't self-install, so they fall back to
// a lightweight GitHub API version check that opens the download page.

let manualUpdateUrl = null;
let updaterWired = false;

function isPortableBuild() {
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}
function canAutoInstall() {
  return app.isPackaged && !isPortableBuild() && !!autoUpdater;
}

function sendUpdaterStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater:status", payload);
  }
}

function parseVersion(v) {
  return String(v).replace(/^v/i, "").split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
}
function isNewerVersion(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function manualUpdateCheck() {
  sendUpdaterStatus({ state: "checking" });
  try {
    const res = await fetch(
      `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`,
      { headers: { "User-Agent": "daoc-qbind-editor", Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) throw new Error("GitHub API " + res.status);
    const data = await res.json();
    const remote = String(data.tag_name || "").replace(/^v/i, "");
    if (remote && isNewerVersion(remote, app.getVersion())) {
      manualUpdateUrl = data.html_url ||
        `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`;
      sendUpdaterStatus({ state: "available", version: remote, canInstall: false });
    } else {
      sendUpdaterStatus({ state: "none" });
    }
  } catch (err) {
    sendUpdaterStatus({ state: "error", message: String((err && err.message) || err) });
  }
}

function runUpdateCheck() {
  if (canAutoInstall()) {
    Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch((err) => sendUpdaterStatus({ state: "error", message: String((err && err.message) || err) }));
  } else {
    manualUpdateCheck();
  }
}

function initUpdater() {
  if (canAutoInstall() && !updaterWired) {
    updaterWired = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => sendUpdaterStatus({ state: "checking" }));
    autoUpdater.on("update-available", (info) =>
      sendUpdaterStatus({ state: "downloading", version: info.version, percent: 0 }));
    autoUpdater.on("update-not-available", () => sendUpdaterStatus({ state: "none" }));
    autoUpdater.on("download-progress", (p) =>
      sendUpdaterStatus({ state: "downloading", percent: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (info) =>
      sendUpdaterStatus({ state: "ready", version: info.version, canInstall: true }));
    autoUpdater.on("error", (err) =>
      sendUpdaterStatus({ state: "error", message: String((err && err.message) || err) }));
  }
  runUpdateCheck();
}

ipcMain.handle("updater:check", () => { runUpdateCheck(); });
ipcMain.on("updater:install", () => {
  if (canAutoInstall()) {
    try {
      autoUpdater.quitAndInstall();
    } catch (err) {
      sendUpdaterStatus({ state: "error", message: String((err && err.message) || err) });
    }
  } else if (manualUpdateUrl) {
    shell.openExternal(manualUpdateUrl);
  }
});

// ---- IPC: filesystem operations ----

ipcMain.handle("fs:get-initial-state", async () => {
  const settings = await loadSettings();
  let edenPath = settings.edenPath;
  if (edenPath && !looksLikeEdenFolder(edenPath)) {
    // Saved path is broken — clear it
    edenPath = null;
  }
  if (!edenPath) {
    edenPath = findEdenFolder();
  }
  return {
    edenPath,
    defaultPath: getDefaultEdenPath(),
    appVersion: app.getVersion(),
  };
});

ipcMain.handle("fs:pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Pick the DAoC eden folder",
    properties: ["openDirectory"],
    defaultPath: getDefaultEdenPath(),
  });
  if (result.canceled || !result.filePaths.length) return null;
  const picked = result.filePaths[0];
  if (!looksLikeEdenFolder(picked)) {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "This doesn't look like an eden folder",
      message: "The selected folder doesn't contain any character INI files.",
      detail: `Expected files like "MyChar-50.ini". Continue anyway?`,
      buttons: ["Use it anyway", "Pick a different folder"],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice.response === 1) return null;
  }
  const settings = await loadSettings();
  settings.edenPath = picked;
  await saveSettings(settings);
  return picked;
});

ipcMain.handle("fs:list-folder", async (event, folderPath) => {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const characters = [];
    const profiles = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (name.startsWith("qbind-profile-") && /\.json$/i.test(name)) {
        profiles.push({ name });
        continue;
      }
      if (!/\.ini$/i.test(name)) continue;
      if (/\.bak$/i.test(name)) continue;
      if (/^(realmwar|user|system|setup|launcher)/i.test(name)) continue;
      characters.push({ name });
    }
    characters.sort((a, b) => a.name.localeCompare(b.name));
    profiles.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, characters, profiles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("fs:read-file", async (event, fullPath) => {
  try {
    const text = await fs.readFile(fullPath, "utf8");
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("fs:write-file", async (event, { fullPath, text, createBackup }) => {
  try {
    if (createBackup) {
      try {
        const original = await fs.readFile(fullPath, "utf8");
        await fs.writeFile(fullPath + ".bak", original, "utf8");
      } catch (e) {
        // If the original doesn't exist, no backup needed
        if (e.code !== "ENOENT") throw e;
      }
    }
    await fs.writeFile(fullPath, text, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("fs:delete-file", async (event, fullPath) => {
  try {
    await fs.unlink(fullPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("fs:rename-file", async (event, { fromPath, toPath, overwrite }) => {
  try {
    if (!overwrite && fssync.existsSync(toPath)) {
      return { ok: false, error: "Destination file already exists." };
    }
    await fs.rename(fromPath, toPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("fs:reveal-folder", async (event, folderPath) => {
  shell.openPath(folderPath);
  return { ok: true };
});

ipcMain.handle("fs:show-save-dialog", async (event, { defaultName, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save profile as…",
    defaultPath: defaultName,
    filters: [{ name: "Profile JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    await fs.writeFile(result.filePath, content, "utf8");
    return { ok: true, savedPath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("fs:show-open-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import profile JSON",
    properties: ["openFile"],
    filters: [{ name: "Profile JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  try {
    const text = await fs.readFile(result.filePaths[0], "utf8");
    return { ok: true, name: path.basename(result.filePaths[0]), text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ui:confirm", async (event, { title, message, detail, kind }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: kind || "question",
    title: title || "Confirm",
    message: message || "",
    detail: detail || "",
    buttons: ["Cancel", "OK"],
    defaultId: 1,
    cancelId: 0,
  });
  return result.response === 1;
});

// ---- DAoC running detection ----
// We poll the process list and look for known DAoC executable names.
// Common ones:  game.dll loaded by game.exe, eden.exe (Eden launcher), Camelot.exe
const DAOC_PROCESSES = ["game.exe", "Camelot.exe", "eden.exe", "EdenLauncher.exe"];
let lastRunningState = null;

function pollDaocRunning() {
  if (process.platform !== "win32") {
    // No-op on non-Windows; the warning banner only matters for Windows users
    return;
  }
  exec("tasklist /FO CSV /NH", { windowsHide: true }, (err, stdout) => {
    let running = false;
    let processName = null;
    if (!err && stdout) {
      const lower = stdout.toLowerCase();
      for (const proc of DAOC_PROCESSES) {
        if (lower.includes('"' + proc.toLowerCase() + '"')) {
          running = true;
          processName = proc;
          break;
        }
      }
    }
    if (running !== lastRunningState) {
      lastRunningState = running;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("daoc:status-changed", { running, processName });
      }
    }
    // Re-poll
    setTimeout(pollDaocRunning, 5000);
  });
}

// ---- App lifecycle ----
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
