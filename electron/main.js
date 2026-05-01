// Main process: creates the window, owns the filesystem, exposes IPC to the renderer.
// All filesystem and process-detection work happens here. The renderer never touches the OS directly.

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const fssync = require("fs");
const { exec } = require("child_process");
const { findEdenFolder, looksLikeEdenFolder, getDefaultEdenPath } = require("./eden-finder");

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
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

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
  });
}

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
