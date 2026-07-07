// ============================================================
// DAoC Qbind Editor — renderer
// All filesystem operations go through window.api (defined in preload.js).
// This file contains:
//   1. Constants: scan code tables, modifier bits, address encoding
//   2. INI parsing and writing
//   3. App state + UI element refs
//   4. Folder loading / character selection / save
//   5. Profile save / apply / multi-character apply
//   6. Bar/bank/slot rendering + bind capture modal
//   7. Toasts
// ============================================================

// ============================================================
// Theme
// "classic" (default gold/brown) and "eden" (green/teal).
// Applied ASAP on load so there's no flash of the wrong palette.
// ============================================================
const THEME_KEY = "daoc-qbind-theme";
const THEMES = ["classic", "eden", "albion", "midgard", "hibernia"];

function applyTheme(theme) {
  // "classic" is the default :root palette — no attribute needed.
  if (theme && theme !== "classic" && THEMES.includes(theme)) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function getSavedTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return THEMES.includes(saved) ? saved : "classic";
}

// Apply immediately (DOM is already parsed — this script is at end of body).
applyTheme(getSavedTheme());

const SCAN_CODE_TO_LABEL = {
  1: "Esc",
  2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7", 9: "8", 10: "9", 11: "0",
  12: "-", 13: "=", 14: "Backspace",
  15: "Tab",
  16: "Q", 17: "W", 18: "E", 19: "R", 20: "T", 21: "Y", 22: "U", 23: "I", 24: "O", 25: "P",
  26: "[", 27: "]", 28: "Enter",
  30: "A", 31: "S", 32: "D", 33: "F", 34: "G", 35: "H", 36: "J", 37: "K", 38: "L",
  39: ";", 40: "'", 41: "`",
  43: "\\",
  44: "Z", 45: "X", 46: "C", 47: "V", 48: "B", 49: "N", 50: "M",
  51: ",", 52: ".", 53: "/",
  55: "Num*",
  57: "Space",
  59: "F1", 60: "F2", 61: "F3", 62: "F4", 63: "F5", 64: "F6",
  65: "F7", 66: "F8", 67: "F9", 68: "F10", 87: "F11", 88: "F12",
  69: "NumLock", 70: "ScrollLock",
  71: "Num7", 72: "Num8", 73: "Num9", 74: "Num-",
  75: "Num4", 76: "Num5", 77: "Num6", 78: "Num+",
  79: "Num1", 80: "Num2", 81: "Num3",
  82: "Num0", 83: "Del",
  156: "NumEnter", 181: "Num/", 183: "PrtScr", 197: "Pause",
  199: "Home", 200: "Up", 201: "PgUp",
  203: "Left", 205: "Right",
  207: "End", 208: "Down", 209: "PgDn",
  210: "Insert", 211: "Del",
};

const JS_CODE_TO_SCAN = {
  "Escape": 1,
  "Digit1": 2, "Digit2": 3, "Digit3": 4, "Digit4": 5, "Digit5": 6,
  "Digit6": 7, "Digit7": 8, "Digit8": 9, "Digit9": 10, "Digit0": 11,
  "Minus": 12, "Equal": 13, "Backspace": 14,
  "Tab": 15,
  "KeyQ": 16, "KeyW": 17, "KeyE": 18, "KeyR": 19, "KeyT": 20,
  "KeyY": 21, "KeyU": 22, "KeyI": 23, "KeyO": 24, "KeyP": 25,
  "BracketLeft": 26, "BracketRight": 27, "Enter": 28,
  "KeyA": 30, "KeyS": 31, "KeyD": 32, "KeyF": 33, "KeyG": 34,
  "KeyH": 35, "KeyJ": 36, "KeyK": 37, "KeyL": 38,
  "Semicolon": 39, "Quote": 40, "Backquote": 41,
  "Backslash": 43,
  "KeyZ": 44, "KeyX": 45, "KeyC": 46, "KeyV": 47, "KeyB": 48,
  "KeyN": 49, "KeyM": 50,
  "Comma": 51, "Period": 52, "Slash": 53,
  "Space": 57,
  "F1": 59, "F2": 60, "F3": 61, "F4": 62, "F5": 63, "F6": 64,
  "F7": 65, "F8": 66, "F9": 67, "F10": 68, "F11": 87, "F12": 88,
  "NumLock": 69, "ScrollLock": 70,
  "Numpad7": 71, "Numpad8": 72, "Numpad9": 73, "NumpadSubtract": 74,
  "Numpad4": 75, "Numpad5": 76, "Numpad6": 77, "NumpadAdd": 78,
  "Numpad1": 79, "Numpad2": 80, "Numpad3": 81,
  "Numpad0": 82, "NumpadDecimal": 83,
  "NumpadEnter": 156, "NumpadDivide": 181, "NumpadMultiply": 55,
  "Pause": 197,
  "Home": 199, "ArrowUp": 200, "PageUp": 201,
  "ArrowLeft": 203, "ArrowRight": 205,
  "End": 207, "ArrowDown": 208, "PageDown": 209,
  "Insert": 210, "Delete": 211,
  "PrintScreen": 183,
};

const MOD_SHIFT = 1, MOD_ALT = 2, MOD_CTRL = 4;
const PROFILE_PREFIX = "qbind-profile-";
const PROFILE_VERSION = 1;

function modifierLabel(mod) {
  const parts = [];
  if (mod & MOD_CTRL) parts.push("Ctrl");
  if (mod & MOD_ALT) parts.push("Alt");
  if (mod & MOD_SHIFT) parts.push("Shift");
  return parts.join("+");
}
function keyLabel(scan) { return SCAN_CODE_TO_LABEL[scan] || `Key${scan}`; }
function encodeQbindAddress(bar, bank, slot) { return (bar - 1) * 100 + bank * 10 + (slot - 1); }
function formatQbindKey(addr) { return "Qbind" + String(addr).padStart(3, "0"); }
function decodeQbindAddress(addr) {
  const bar = Math.floor(addr / 100) + 1;
  const rem = addr - (bar - 1) * 100;
  const bank = Math.floor(rem / 10);
  const slot = (rem % 10) + 1;
  return { bar, bank, slot };
}

// ============================================================
// INI parsing/writing
// ============================================================
function parseIni(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = { name: "__preamble__", lines: [] };
  sections.push(current);
  for (const line of lines) {
    const m = line.match(/^\s*\[(.+?)\]\s*$/);
    if (m) {
      current = { name: m[1], lines: [line] };
      sections.push(current);
    } else {
      current.lines.push(line);
    }
  }
  return { sections, eol };
}

function getQbinds(parsed) {
  const binds = {};
  const qbSection = parsed.sections.find(s => s.name === "QuickBinds");
  if (!qbSection) return binds;
  for (const line of qbSection.lines) {
    const m = line.match(/^Qbind(\d{3})\s*=\s*(\d+)\s*,\s*(\d+)\s*$/);
    if (m) {
      const addr = parseInt(m[1], 10);
      binds[addr] = { scan: parseInt(m[2], 10), mod: parseInt(m[3], 10) };
    }
  }
  return binds;
}

function getMacros(parsed) {
  const macros = {};
  const section = parsed.sections.find(s => s.name === "Macros");
  if (!section) return macros;
  for (const line of section.lines) {
    const m = line.match(/^Macro_(\d+)\s*=\s*([^,]*),(.*)$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      macros[idx] = { name: m[2], command: m[3] };
    }
  }
  return macros;
}

function writeSection(parsed, sectionName, newLines) {
  const existing = parsed.sections.findIndex(s => s.name === sectionName);
  let newSections;
  if (existing !== -1) {
    const oldLines = parsed.sections[existing].lines;
    let trailingBlanks = 0;
    for (let i = oldLines.length - 1; i >= 0; i--) {
      if (oldLines[i].trim() === "") trailingBlanks++;
      else break;
    }
    const finalLines = [`[${sectionName}]`, ...newLines];
    for (let i = 0; i < trailingBlanks; i++) finalLines.push("");
    newSections = parsed.sections.slice();
    newSections[existing] = { name: sectionName, lines: finalLines };
  } else {
    newSections = parsed.sections.slice();
    newSections.push({ name: sectionName, lines: ["", `[${sectionName}]`, ...newLines] });
  }
  return { ...parsed, sections: newSections };
}

function writeIni(parsed, binds, macros) {
  const sortedAddrs = Object.keys(binds).map(Number).sort((a, b) => a - b);
  const qbLines = sortedAddrs.map(addr => {
    const { scan, mod } = binds[addr];
    return `${formatQbindKey(addr)}=${scan},${mod}`;
  });
  let newParsed = writeSection(parsed, "QuickBinds", qbLines);
  if (macros) {
    const sortedIdx = Object.keys(macros).map(Number).sort((a, b) => a - b);
    const mLines = sortedIdx.map(i => `Macro_${i}=${macros[i].name},${macros[i].command}`);
    newParsed = writeSection(newParsed, "Macros", mLines);
  }
  const out = [];
  for (const section of newParsed.sections) {
    for (const line of section.lines) out.push(line);
  }
  return out.join(parsed.eol);
}

// ============================================================
// State
// ============================================================
const state = {
  edenPath: null,
  defaultPath: null,
  characters: [],   // [{name}]
  charSearch: "",
  profiles: [],     // [{name, displayName, data}]
  current: null,    // {name, parsed, binds, macros, originalBinds, originalMacros, dirty}
  backedUpThisSession: new Set(),
  selectedBank: { 1: 1, 2: 1, 3: 1 },
  expanded: false,
  daocRunning: false,
};

// Element refs
const $ = (id) => document.getElementById(id);
const $empty = $("empty");
const $defaultPath = $("default-path");
const $layout = $("layout");
const $sidebar = $("sidebar");
const $bars = $("bars");
const $charList = $("char-list");
const $charSearch = $("char-search");
const $profileList = $("profile-list");
const $folderName = $("folder-name");
const $filename = $("filename");
const $saveBtn = $("save-btn");
const $exportBtn = $("export-btn");
const $clearBtn = $("clear-btn");
const $expandToggle = $("expand-toggle");
const $saveProfileBtn = $("save-profile-btn");
const $applyMultiBtn = $("apply-multi-btn");
const $refreshBtn = $("refresh-folder-btn");
const $revealBtn = $("reveal-folder-btn");
const $importProfileBtn = $("import-profile-btn");
const $pickFolderEmpty = $("pick-folder-btn-empty");
const $daocWarning = $("daoc-warning");
const $themeSelect = $("theme-select");
const $titlebar = $("titlebar");
const $winMin = $("win-min");
const $winMax = $("win-max");
const $winClose = $("win-close");
const $winMenuBtn = $("win-menu-btn");
const $winMenu = $("win-menu");

// ============================================================
// Init
// ============================================================
async function init() {
  // Theme selector (theme itself was already applied at load time)
  $themeSelect.value = getSavedTheme();
  $themeSelect.addEventListener("change", (e) => {
    const theme = THEMES.includes(e.target.value) ? e.target.value : "classic";
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  });

  initTitleBar();

  const initial = await window.api.getInitialState();
  state.defaultPath = initial.defaultPath;
  document.title = `DAoC Qbind Editor v${initial.appVersion}`;

  if (initial.edenPath) {
    state.edenPath = initial.edenPath;
    await loadFolder();
  } else {
    showEmptyState();
  }

  // Wire up DAoC running events
  window.api.onDaocStatusChanged(({ running }) => {
    state.daocRunning = running;
    $daocWarning.style.display = running ? "" : "none";
  });
  window.api.onMenuChangeFolder(() => pickFolder());
  window.api.onMenuReloadFolder(() => loadFolder());

  // Wire up buttons
  $pickFolderEmpty.addEventListener("click", pickFolder);
  $refreshBtn.addEventListener("click", loadFolder);
  $revealBtn.addEventListener("click", () => {
    if (state.edenPath) window.api.revealFolder(state.edenPath);
  });
  $importProfileBtn.addEventListener("click", importProfile);
  $charSearch.addEventListener("input", (e) => {
    state.charSearch = e.target.value;
    renderCharList();
  });

  $saveBtn.addEventListener("click", saveCurrent);
  $exportBtn.addEventListener("click", exportCurrent);
  $clearBtn.addEventListener("click", clearAllBinds);
  $expandToggle.addEventListener("click", toggleExpand);
  $saveProfileBtn.addEventListener("click", openSaveProfileModal);
  $applyMultiBtn.addEventListener("click", openMultiApplyModal);

  window.addEventListener("beforeunload", (e) => {
    if (state.current && state.current.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

// ============================================================
// Frameless title bar (window controls + hamburger menu)
// ============================================================
const MAX_GLYPH = "□";      // □  maximize
const RESTORE_GLYPH = "❐";  // ❐  restore (window is maximized)

function setMaxGlyph(isMax) {
  $winMax.textContent = isMax ? RESTORE_GLYPH : MAX_GLYPH;
  $winMax.title = isMax ? "Restore" : "Maximize";
}

function closeWinMenu() { $winMenu.hidden = true; }

function initTitleBar() {
  $winMin.addEventListener("click", () => window.api.windowMinimize());
  $winMax.addEventListener("click", () => window.api.windowMaximizeToggle());
  $winClose.addEventListener("click", () => window.api.windowClose());

  // Double-clicking the draggable area toggles maximize, like a native bar.
  $titlebar.addEventListener("dblclick", (e) => {
    if (e.target.closest(".titlebar-controls")) return;
    window.api.windowMaximizeToggle();
  });

  // Keep the maximize/restore glyph in sync.
  window.api.onWindowMaximizedChange(setMaxGlyph);
  window.api.windowIsMaximized().then(setMaxGlyph);

  // Hamburger menu (replaces the old native File/Help menu items).
  $winMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    $winMenu.hidden = !$winMenu.hidden;
  });
  $("menu-change-folder").addEventListener("click", () => { closeWinMenu(); pickFolder(); });
  $("menu-reload-folder").addEventListener("click", () => { closeWinMenu(); loadFolder(); });
  $("menu-about").addEventListener("click", () => { closeWinMenu(); window.api.showAbout(); });

  // Close the menu on any outside click or Escape.
  document.addEventListener("click", (e) => {
    if (!$winMenu.hidden && !e.target.closest(".win-menu-wrap")) closeWinMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeWinMenu();
  });
}

function showEmptyState() {
  $empty.style.display = "";
  $layout.style.display = "none";
  $defaultPath.textContent = `Default: ${state.defaultPath}`;
}

async function pickFolder() {
  const path = await window.api.pickFolder();
  if (path) {
    state.edenPath = path;
    state.current = null;
    state.backedUpThisSession = new Set();
    await loadFolder();
  }
}

// ============================================================
// Folder loading
// ============================================================
function fullPath(filename) {
  const sep = state.edenPath.includes("\\") ? "\\" : "/";
  return state.edenPath + sep + filename;
}

async function loadFolder() {
  if (!state.edenPath) return;
  const result = await window.api.listFolder(state.edenPath);
  if (!result.ok) {
    showToast("Failed to read folder: " + result.error, "error");
    return;
  }

  // Load all profiles
  const profiles = [];
  for (const p of result.profiles) {
    const r = await window.api.readFile(fullPath(p.name));
    if (!r.ok) continue;
    try {
      const data = JSON.parse(r.text);
      profiles.push({
        name: p.name,
        displayName: data.name || p.name.replace(PROFILE_PREFIX, "").replace(/\.json$/i, ""),
        data,
      });
    } catch (e) {
      console.warn("Skipped invalid profile:", p.name, e);
    }
  }
  profiles.sort((a, b) => a.displayName.localeCompare(b.displayName));

  state.characters = result.characters;
  state.profiles = profiles;

  $folderName.textContent = state.edenPath;
  $folderName.title = state.edenPath;
  $empty.style.display = "none";
  $layout.style.display = "";
  renderCharList();
  renderProfileList();

  if (state.characters.length === 0) {
    $bars.innerHTML = `<div class="empty-state"><h2>No character INI files found</h2><p>Make sure you picked the eden folder.</p></div>`;
    state.current = null;
    updateToolbar();
  } else {
    const cur = state.current;
    const stillValid = cur && (cur.type === "profile"
      ? state.profiles.some(p => p.name === cur.name)
      : state.characters.some(c => c.name === cur.name));
    if (!stillValid) {
      state.current = null;
      const groups = characterGroups();
      if (groups.length) await selectCharacter(defaultSpec(groups[0]));
    }
  }
  showToast(`${state.characters.length} character${state.characters.length === 1 ? "" : "s"}, ${profiles.length} profile${profiles.length === 1 ? "" : "s"}`);
}

async function selectCharacter(charEntry) {
  if (!(await confirmDiscardOrSave())) return;
  const r = await window.api.readFile(fullPath(charEntry.name));
  if (!r.ok) {
    showToast("Failed to read file: " + r.error, "error");
    return;
  }
  const parsed = parseIni(r.text);
  const binds = getQbinds(parsed);
  const macros = getMacros(parsed);
  state.current = {
    type: "character",
    name: charEntry.name,
    parsed,
    binds,
    macros,
    originalBinds: JSON.parse(JSON.stringify(binds)),
    originalMacros: JSON.parse(JSON.stringify(macros)),
    dirty: false,
  };
  setDefaultBanks(binds);
  updateToolbar();
  renderBars();
  renderCharList();
  renderProfileList();
}

// Pick the first bank with binds for each bar (so the user lands on a used bank).
function setDefaultBanks(binds) {
  for (let bar = 1; bar <= 3; bar++) {
    let found = null;
    for (let bank = 1; bank <= 10; bank++) {
      if (bankHasBinds(binds, bar, bank)) { found = bank; break; }
    }
    state.selectedBank[bar] = found || 1;
  }
}

// Load a profile into the editor (like selecting a character, but the source
// is a JSON profile). Saving writes back to that profile file.
async function selectProfile(profile) {
  if (!(await confirmDiscardOrSave())) return;
  const data = profile.data || {};
  const binds = JSON.parse(JSON.stringify(data.binds || {}));
  const macros = JSON.parse(JSON.stringify(data.macros || {}));
  state.current = {
    type: "profile",
    name: profile.name,
    displayName: profile.displayName,
    data,
    // Profiles have no INI structure; give an empty base so Export INI works.
    parsed: parseIni(""),
    binds,
    macros,
    originalBinds: JSON.parse(JSON.stringify(binds)),
    originalMacros: JSON.parse(JSON.stringify(macros)),
    dirty: false,
  };
  setDefaultBanks(binds);
  updateToolbar();
  renderBars();
  renderCharList();
  renderProfileList();
}

// Guard-rail: if the current source has unsaved edits, ask Save / Discard /
// Cancel. Returns true to proceed with the switch, false to abort it.
async function confirmDiscardOrSave() {
  if (!state.current || !state.current.dirty) return true;
  const choice = await promptUnsavedChanges(currentLabel());
  if (choice === "cancel") return false;
  if (choice === "save") return await saveCurrent();
  return true; // discard
}

// Themed in-app "unsaved changes" prompt. Resolves "save" | "discard" | "cancel".
function promptUnsavedChanges(name) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h3>Unsaved changes</h3>
      <div class="ctx">Save your changes to <strong>${escapeHtml(name || "the current item")}</strong>? If you don't, they'll be lost.</div>
      <div class="modal-actions">
        <button class="left" id="u-cancel">Cancel</button>
        <button id="u-discard">Don't save</button>
        <button class="primary" id="u-save">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    let done = false;
    const finish = (choice) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      document.body.removeChild(backdrop);
      resolve(choice);
    };
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); finish("cancel"); }
      else if (e.key === "Enter") { e.stopPropagation(); finish("save"); }
    }
    modal.querySelector("#u-cancel").addEventListener("click", () => finish("cancel"));
    modal.querySelector("#u-discard").addEventListener("click", () => finish("discard"));
    modal.querySelector("#u-save").addEventListener("click", () => finish("save"));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) finish("cancel"); });
    document.addEventListener("keydown", onKey, true);
    modal.querySelector("#u-save").focus();
  });
}

function specName(spec) {
  if (spec === 41) return "Spec 1";
  if (spec === 42) return "Spec 2";
  return spec != null ? `Spec ${spec}` : null;
}

// Human-readable name for whatever is loaded (used in the toolbar + prompts).
function currentLabel() {
  const c = state.current;
  if (!c) return "";
  if (c.type === "profile") return c.displayName;
  const { base, spec } = parseCharName(c.name);
  const sn = specName(spec);
  return sn ? `${base} — ${sn}` : base;
}

// Returns true on success, false if the save was cancelled or failed.
async function saveCurrent() {
  if (!state.current) return false;
  if (state.current.type === "profile") return await saveCurrentProfile();

  if (state.daocRunning) {
    const ok = await window.api.confirm({
      kind: "warning",
      title: "DAoC is running",
      message: "DAoC is currently running.",
      detail: "Saving now will work, but the game will overwrite your changes when you log out. Save anyway?",
    });
    if (!ok) return false;
  }
  const out = writeIni(state.current.parsed, state.current.binds, state.current.macros);
  const createBackup = !state.backedUpThisSession.has(state.current.name);
  const r = await window.api.writeFile(fullPath(state.current.name), out, createBackup);
  if (!r.ok) {
    showToast("Save failed: " + r.error, "error");
    return false;
  }
  if (createBackup) state.backedUpThisSession.add(state.current.name);
  state.current.originalBinds = JSON.parse(JSON.stringify(state.current.binds));
  state.current.originalMacros = JSON.parse(JSON.stringify(state.current.macros));
  state.current.dirty = false;
  state.current.parsed = parseIni(out);
  updateToolbar();
  renderCharList();
  showToast(createBackup ? `Saved (backup: ${state.current.name}.bak)` : `Saved ${state.current.name}`);
  return true;
}

// Save the currently-loaded profile back to its JSON file.
async function saveCurrentProfile() {
  const cur = state.current;
  const data = {
    ...(cur.data || {}),
    formatVersion: PROFILE_VERSION,
    name: cur.displayName,
    savedAt: new Date().toISOString(),
    binds: cur.binds,
    macros: cur.macros,
  };
  const r = await window.api.writeFile(fullPath(cur.name), JSON.stringify(data, null, 2), false);
  if (!r.ok) {
    showToast("Save failed: " + r.error, "error");
    return false;
  }
  cur.data = data;
  cur.originalBinds = JSON.parse(JSON.stringify(cur.binds));
  cur.originalMacros = JSON.parse(JSON.stringify(cur.macros));
  cur.dirty = false;
  const p = state.profiles.find(p => p.name === cur.name);
  if (p) p.data = data;
  updateToolbar();
  renderProfileList();
  showToast(`Saved profile: ${cur.displayName}`);
  return true;
}

async function exportCurrent() {
  if (!state.current) return;
  const out = writeIni(state.current.parsed, state.current.binds, state.current.macros);
  const r = await window.api.showSaveDialog(state.current.name, out);
  if (r.ok) showToast(`Exported to ${r.savedPath}`);
  else if (r.error) showToast("Export failed: " + r.error, "error");
}

async function clearAllBinds() {
  if (!state.current) return;
  const ok = await window.api.confirm({
    kind: "warning",
    title: "Clear all binds",
    message: "Clear ALL qbinds?",
    detail: "You'll still need to click Save to write the change to disk.",
  });
  if (!ok) return;
  state.current.binds = {};
  markDirty();
  renderBars();
  renderCharList();
  showToast("All qbinds cleared (Save to apply).");
}

function toggleExpand() {
  state.expanded = !state.expanded;
  $expandToggle.classList.toggle("active", state.expanded);
  $expandToggle.textContent = state.expanded ? "Collapse banks" : "Expand all banks";
  renderBars();
}

// ============================================================
// Toolbar / dirty state
// ============================================================
function updateToolbar() {
  if (!state.current) {
    $filename.textContent = "";
    $saveBtn.disabled = true;
    $exportBtn.disabled = true;
    $clearBtn.disabled = true;
    $expandToggle.disabled = true;
    $saveProfileBtn.disabled = true;
    $applyMultiBtn.disabled = true;
    return;
  }
  const label = state.current.type === "profile"
    ? `Profile: ${state.current.displayName}`
    : currentLabel();
  $filename.innerHTML = (state.current.dirty ? '<span class="dirty-indicator"></span>' : '') + escapeHtml(label);
  $saveBtn.disabled = !state.current.dirty;
  $exportBtn.disabled = false;
  $clearBtn.disabled = Object.keys(state.current.binds).length === 0;
  $expandToggle.disabled = false;
  $saveProfileBtn.disabled = Object.keys(state.current.binds).length === 0;
  $applyMultiBtn.disabled = Object.keys(state.current.binds).length === 0;
}

function markDirty() {
  if (!state.current) return;
  state.current.dirty = true;
  updateToolbar();
}

// ============================================================
// Sidebar rendering
// ============================================================
// Character files on Eden are named "<Name>-41.ini" (Spec 1) and
// "<Name>-42.ini" (Spec 2). Group files by base name so the list shows one
// entry per character; the user picks a spec after selecting.
function parseCharName(filename) {
  const base = filename.replace(/\.ini$/i, "");
  const m = base.match(/^(.*)[-.](\d+)$/);
  if (m) return { base: m[1], spec: parseInt(m[2], 10) };
  return { base, spec: null };
}

function characterGroups() {
  const groups = [];
  const byBase = new Map();
  for (const c of state.characters) {
    const { base, spec } = parseCharName(c.name);
    let g = byBase.get(base);
    if (!g) { g = { base, specs: [] }; byBase.set(base, g); groups.push(g); }
    g.specs.push({ name: c.name, spec });
  }
  for (const g of groups) g.specs.sort((a, b) => (a.spec ?? 0) - (b.spec ?? 0));
  return groups;
}

// When a character is picked, default to Spec 1 (…-41) if present, else the first.
function defaultSpec(group) {
  return group.specs.find(s => s.spec === 41) || group.specs[0];
}

function specLabel(spec, index) {
  if (spec === 41) return "Spec 1";
  if (spec === 42) return "Spec 2";
  return `Spec ${index + 1}`;
}

function renderCharList() {
  $charList.innerHTML = "";
  const groups = characterGroups();
  if (groups.length === 0) {
    const empty = document.createElement("li");
    empty.className = "sidebar-empty";
    empty.textContent = "No INI files found";
    $charList.appendChild(empty);
    return;
  }
  const query = state.charSearch.trim().toLowerCase();
  const filtered = query
    ? groups.filter(g => g.base.toLowerCase().includes(query))
    : groups;
  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "sidebar-empty";
    empty.textContent = `No matches for ${state.charSearch}`;
    $charList.appendChild(empty);
    return;
  }
  const currentName = (state.current && state.current.type === "character") ? state.current.name : null;
  for (const group of filtered) {
    const isActive = currentName != null && group.specs.some(s => s.name === currentName);
    const li = document.createElement("li");
    li.className = "char-item" + (isActive ? " active" : "");

    const head = document.createElement("div");
    head.className = "char-head";
    const name = document.createElement("span");
    name.className = "char-name";
    name.textContent = group.base;
    head.appendChild(name);
    if (isActive && state.current && state.current.dirty) {
      const dot = document.createElement("span");
      dot.className = "dirty-dot";
      dot.title = "Unsaved changes";
      head.appendChild(dot);
    }
    head.addEventListener("click", () => {
      if (!isActive) selectCharacter(defaultSpec(group));
    });
    li.appendChild(head);

    // Spec picker: only when this character is selected and has more than one spec.
    if (isActive && group.specs.length > 1) {
      const specs = document.createElement("div");
      specs.className = "char-specs";
      group.specs.forEach((s, i) => {
        const btn = document.createElement("button");
        btn.className = "spec-btn" + (s.name === currentName ? " active" : "");
        btn.textContent = specLabel(s.spec, i);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (s.name !== currentName) selectCharacter(s);
        });
        specs.appendChild(btn);
      });
      li.appendChild(specs);
    }

    $charList.appendChild(li);
  }
}

function renderProfileList() {
  $profileList.innerHTML = "";
  if (state.profiles.length === 0) {
    const empty = document.createElement("li");
    empty.className = "sidebar-empty";
    empty.textContent = "No profiles saved";
    $profileList.appendChild(empty);
    return;
  }
  const currentName = (state.current && state.current.type === "profile") ? state.current.name : null;
  for (const profile of state.profiles) {
    const isActive = profile.name === currentName;
    const li = document.createElement("li");
    li.className = "profile-item" + (isActive ? " active" : "");
    li.title = `Edit ${profile.displayName}`;
    const name = document.createElement("span");
    name.className = "profile-name";
    name.textContent = profile.displayName;
    li.appendChild(name);
    if (isActive && state.current && state.current.dirty) {
      const dot = document.createElement("span");
      dot.className = "dirty-dot";
      dot.title = "Unsaved changes";
      li.appendChild(dot);
    }

    const actions = document.createElement("div");
    actions.className = "profile-actions";
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "↓";
    exportBtn.title = "Export profile JSON";
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportProfile(profile);
    });
    const renameBtn = document.createElement("button");
    renameBtn.textContent = "✎";
    renameBtn.title = "Rename";
    renameBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await renameProfile(profile);
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "✕";
    deleteBtn.className = "danger";
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteProfile(profile);
    });
    actions.appendChild(exportBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(actions);

    li.addEventListener("click", () => selectProfile(profile));
    $profileList.appendChild(li);
  }
}

// ============================================================
// Bar rendering
// ============================================================
let lastWheelMs = 0;
function bankHasBinds(binds, bar, bank) {
  for (let slot = 1; slot <= 10; slot++) {
    if (binds[encodeQbindAddress(bar, bank, slot)]) return true;
  }
  return false;
}
function bankBindCount(binds, bar, bank) {
  let count = 0;
  for (let slot = 1; slot <= 10; slot++) {
    if (binds[encodeQbindAddress(bar, bank, slot)]) count++;
  }
  return count;
}

function renderBars() {
  $bars.innerHTML = "";
  if (!state.current) return;
  for (let bar = 1; bar <= 3; bar++) $bars.appendChild(renderBar(bar));
}

function renderBar(bar) {
  const wrap = document.createElement("div");
  wrap.className = "bar" + (state.expanded ? " expanded" : "");
  wrap.addEventListener("wheel", (e) => {
    if (state.expanded) return;
    e.preventDefault();
    const now = Date.now();
    if (now - lastWheelMs < 120) return;
    lastWheelMs = now;
    const step = e.deltaY > 0 ? 1 : -1;
    const newBank = Math.max(1, Math.min(10, state.selectedBank[bar] + step));
    if (newBank === state.selectedBank[bar]) return;
    state.selectedBank[bar] = newBank;
    renderBars();
  }, { passive: false });

  const header = document.createElement("div");
  header.className = "bar-header";
  const title = document.createElement("div");
  title.className = "bar-title";
  title.textContent = `Quickbar ${bar}`;
  header.appendChild(title);

  let totalCount = 0;
  for (const addr in state.current.binds) {
    if (decodeQbindAddress(parseInt(addr)).bar === bar) totalCount++;
  }
  const stats = document.createElement("div");
  stats.className = "bar-stats";
  stats.textContent = `${totalCount} bound`;
  header.appendChild(stats);

  const bankSel = document.createElement("div");
  bankSel.className = "bank-selector";
  for (let bank = 1; bank <= 10; bank++) {
    const chip = document.createElement("div");
    chip.className = "bank-chip";
    if (state.selectedBank[bar] === bank) chip.classList.add("active");
    if (bankHasBinds(state.current.binds, bar, bank)) chip.classList.add("has-binds");
    chip.textContent = bank;
    const count = bankBindCount(state.current.binds, bar, bank);
    chip.title = `Bank ${bank}` + (count ? ` — ${count} bound` : "");
    chip.addEventListener("click", () => {
      state.selectedBank[bar] = bank;
      renderBars();
    });
    bankSel.appendChild(chip);
  }
  header.appendChild(bankSel);
  wrap.appendChild(header);

  const row = document.createElement("div");
  row.className = "bank-row";
  const currentBank = state.selectedBank[bar];
  for (let slot = 1; slot <= 10; slot++) {
    row.appendChild(renderSlot(bar, currentBank, slot, true));
  }
  wrap.appendChild(row);

  const grid = document.createElement("div");
  grid.className = "full-grid";
  const corner = document.createElement("div");
  corner.className = "col-header";
  corner.textContent = "";
  grid.appendChild(corner);
  for (let s = 1; s <= 10; s++) {
    const ch = document.createElement("div");
    ch.className = "col-header";
    ch.textContent = s;
    grid.appendChild(ch);
  }
  for (let bank = 1; bank <= 10; bank++) {
    const rl = document.createElement("div");
    rl.className = "row-label";
    rl.textContent = bank;
    grid.appendChild(rl);
    for (let slot = 1; slot <= 10; slot++) grid.appendChild(renderSlot(bar, bank, slot, false));
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderSlot(bar, bank, slot, showSlotNum) {
  const addr = encodeQbindAddress(bar, bank, slot);
  const bind = state.current.binds[addr];
  const el = document.createElement("div");
  el.className = "slot" + (bind ? " bound" : "");
  el.title = `Bar ${bar} · Bank ${bank} · Slot ${slot}` + (bind ? `\n${modifierLabel(bind.mod) ? modifierLabel(bind.mod) + "+" : ""}${keyLabel(bind.scan)}` : "");
  if (showSlotNum) {
    const num = document.createElement("div");
    num.className = "slot-num";
    num.textContent = slot;
    el.appendChild(num);
  }
  if (bind) {
    if (bind.mod) {
      const modEl = document.createElement("div");
      modEl.className = "mod";
      modEl.textContent = modifierLabel(bind.mod);
      el.appendChild(modEl);
    }
    const keyEl = document.createElement("div");
    keyEl.className = "key";
    keyEl.textContent = keyLabel(bind.scan);
    el.appendChild(keyEl);
  }
  el.addEventListener("click", () => openBindModal(bar, bank, slot));
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (state.current.binds[addr]) {
      delete state.current.binds[addr];
      markDirty();
      renderBars();
      renderCharList();
      showToast(`Cleared bar ${bar} bank ${bank} slot ${slot}`);
    }
  });
  return el;
}

// ============================================================
// Bind capture modal
// ============================================================
function openBindModal(bar, bank, slot) {
  const addr = encodeQbindAddress(bar, bank, slot);
  const current = state.current.binds[addr] || null;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.tabIndex = 0;
  modal.innerHTML = `
    <h3>Bind quickbar slot</h3>
    <div class="ctx">Bar ${bar} · Bank ${bank} · Slot ${slot}</div>
    <div class="capture-display">
      <div class="capture-prompt">Press a key (with optional modifiers)</div>
      <div class="capture-keys empty" id="capture-out">waiting...</div>
    </div>
    <div class="modal-actions">
      ${current ? '<button class="left danger" id="m-clear">Clear binding</button>' : ''}
      <button id="m-cancel">Cancel</button>
      <button class="primary" id="m-save" disabled>Apply</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  modal.focus();

  let captured = null;
  function updateDisplay() {
    const out = modal.querySelector("#capture-out");
    if (!captured) {
      out.className = "capture-keys empty";
      out.textContent = "waiting...";
      modal.querySelector("#m-save").disabled = true;
      return;
    }
    out.className = "capture-keys";
    out.innerHTML = "";
    if (captured.mod & MOD_CTRL) {
      const t = document.createElement("span"); t.className = "mod-tag ctrl"; t.textContent = "Ctrl"; out.appendChild(t);
    }
    if (captured.mod & MOD_ALT) {
      const t = document.createElement("span"); t.className = "mod-tag alt"; t.textContent = "Alt"; out.appendChild(t);
    }
    if (captured.mod & MOD_SHIFT) {
      const t = document.createElement("span"); t.className = "mod-tag shift"; t.textContent = "Shift"; out.appendChild(t);
    }
    const keySpan = document.createElement("span");
    keySpan.textContent = keyLabel(captured.scan);
    out.appendChild(keySpan);
    modal.querySelector("#m-save").disabled = false;
  }
  function onKey(e) {
    if (["ShiftLeft","ShiftRight","ControlLeft","ControlRight","AltLeft","AltRight","MetaLeft","MetaRight"].includes(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    const scan = JS_CODE_TO_SCAN[e.code];
    if (scan === undefined) {
      showToast(`Unsupported key: ${e.code}`, "warn");
      return;
    }
    let mod = 0;
    if (e.shiftKey) mod |= MOD_SHIFT;
    if (e.altKey) mod |= MOD_ALT;
    if (e.ctrlKey) mod |= MOD_CTRL;
    captured = { scan, mod };
    updateDisplay();
  }
  function close() {
    document.removeEventListener("keydown", onKey, true);
    document.body.removeChild(backdrop);
  }
  document.addEventListener("keydown", onKey, true);
  modal.querySelector("#m-cancel").addEventListener("click", close);
  modal.querySelector("#m-save").addEventListener("click", () => {
    if (!captured) return;
    state.current.binds[addr] = captured;
    markDirty();
    renderBars();
    renderCharList();
    showToast(`Bound ${modifierLabel(captured.mod) ? modifierLabel(captured.mod) + "+" : ""}${keyLabel(captured.scan)} → bar ${bar} bank ${bank} slot ${slot}`);
    close();
  });
  const clearBtn = modal.querySelector("#m-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      delete state.current.binds[addr];
      markDirty();
      renderBars();
      renderCharList();
      showToast(`Cleared bar ${bar} bank ${bank} slot ${slot}`);
      close();
    });
  }
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
}

// ============================================================
// Profiles
// ============================================================
function sanitizeProfileFilename(name) {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function buildProfileData(displayName, binds, macros) {
  return {
    formatVersion: PROFILE_VERSION,
    name: displayName,
    savedAt: new Date().toISOString(),
    sourceCharacter: (state.current && state.current.type === "character") ? state.current.name.replace(/\.ini$/i, "") : null,
    binds,
    macros,
  };
}

function openSaveProfileModal() {
  if (!state.current) return;
  const macroCount = Object.keys(state.current.macros).length;
  const bindCount = Object.keys(state.current.binds).length;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <h3>Save profile</h3>
    <div class="ctx">Saves your current qbinds + macros to a JSON file in the eden folder.</div>
    <div class="field">
      <label class="field-label">Profile name</label>
      <input type="text" id="profile-name-input" placeholder="e.g. PvE Reaver, BG Crafter, Standard">
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="include-macros-cb" checked>
      <label for="include-macros-cb">Include macros (${macroCount} defined)</label>
    </div>
    <div class="summary-block" id="profile-summary">
      Will save <strong>${bindCount}</strong> qbind${bindCount === 1 ? "" : "s"}<span id="macro-summary"> and <strong>${macroCount}</strong> macro${macroCount === 1 ? "" : "s"}</span>.
    </div>
    <div class="modal-actions" style="margin-top: 16px;">
      <button id="m-cancel">Cancel</button>
      <button class="primary" id="m-save" disabled>Save profile</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const input = modal.querySelector("#profile-name-input");
  const saveBtn = modal.querySelector("#m-save");
  const includeMacros = modal.querySelector("#include-macros-cb");
  const macroSummary = modal.querySelector("#macro-summary");
  input.focus();

  function updateState() {
    saveBtn.disabled = input.value.trim() === "";
    macroSummary.style.display = includeMacros.checked ? "" : "none";
  }
  input.addEventListener("input", updateState);
  includeMacros.addEventListener("change", updateState);
  function close() { document.body.removeChild(backdrop); }
  modal.querySelector("#m-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  saveBtn.addEventListener("click", async () => {
    const displayName = input.value.trim();
    if (!displayName) return;
    const safe = sanitizeProfileFilename(displayName);
    if (!safe) {
      showToast("Profile name has no valid characters.", "error");
      return;
    }
    const filename = PROFILE_PREFIX + safe + ".json";
    const existing = state.profiles.find(p => p.name.toLowerCase() === filename.toLowerCase());
    if (existing) {
      const ok = await window.api.confirm({
        title: "Profile exists",
        message: `A profile named "${existing.displayName}" already exists. Overwrite?`,
      });
      if (!ok) return;
    }
    const macros = includeMacros.checked ? state.current.macros : {};
    const data = buildProfileData(displayName, state.current.binds, macros);
    const r = await window.api.writeFile(fullPath(filename), JSON.stringify(data, null, 2), false);
    if (!r.ok) {
      showToast("Save failed: " + r.error, "error");
      return;
    }
    showToast(`Saved profile: ${displayName}`);
    close();
    await loadFolder();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !saveBtn.disabled) saveBtn.click();
  });
  updateState();
}

// Merge a source set of binds/macros into a target set per the chosen modes.
function mergeBindsMacros(srcBinds, srcMacros, curBinds, curMacros, qMode, mMode) {
  let newBinds = qMode === "replace" ? {} : { ...curBinds };
  for (const addr in (srcBinds || {})) {
    newBinds[parseInt(addr)] = { ...srcBinds[addr] };
  }
  let newMacros = curMacros;
  if (mMode !== "skip") {
    newMacros = mMode === "replace" ? {} : { ...curMacros };
    for (const idx in (srcMacros || {})) {
      newMacros[parseInt(idx)] = { ...srcMacros[idx] };
    }
  }
  return { binds: newBinds, macros: newMacros };
}

// ============================================================
// Multi-character apply
// ============================================================
function openMultiApplyModal() {
  if (!state.current || Object.keys(state.current.binds).length === 0) {
    showToast("Load a character or profile with binds first.", "warn");
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.minWidth = "480px";
  modal.innerHTML = `
    <h3>Apply binds to characters</h3>
    <div class="ctx">Copies the binds/macros from <strong>${escapeHtml(currentLabel())}</strong> into the characters you pick below. Each gets a fresh <code>.bak</code> backup first.</div>

    <label class="field-label" style="margin-bottom: 8px;">Qbinds</label>
    <div class="radio-group" id="qbind-mode">
      <div class="radio-option selected" data-mode="merge">
        <div class="radio-title">Merge</div>
        <div class="radio-desc">Add these binds, leave existing slots alone</div>
      </div>
      <div class="radio-option" data-mode="replace">
        <div class="radio-title">Replace all</div>
        <div class="radio-desc">Clear each character's existing binds first</div>
      </div>
    </div>

    <label class="field-label" style="margin-bottom: 8px;">Macros</label>
    <div class="radio-group" id="macro-mode">
      <div class="radio-option selected" data-mode="merge">
        <div class="radio-title">Merge</div>
        <div class="radio-desc">Add these macros, they win on conflicts</div>
      </div>
      <div class="radio-option" data-mode="replace">
        <div class="radio-title">Replace all</div>
        <div class="radio-desc">Use only these macros</div>
      </div>
      <div class="radio-option" data-mode="skip">
        <div class="radio-title">Skip</div>
        <div class="radio-desc">Don't touch macros</div>
      </div>
    </div>

    <label class="field-label" style="margin-bottom: 8px;">Characters</label>
    <div class="checklist-actions">
      <a id="select-all">Select all</a>
      <a id="select-none">None</a>
    </div>
    <div class="char-checklist" id="char-checklist">
      ${state.characters
        .filter(c => !(state.current.type === "character" && c.name === state.current.name))
        .map(c => {
          const { base, spec } = parseCharName(c.name);
          const sn = specName(spec);
          return `
        <label class="char-row">
          <input type="checkbox" data-name="${escapeHtml(c.name)}">
          ${escapeHtml(sn ? `${base} — ${sn}` : base)}
        </label>`;
        }).join("")}
    </div>

    <div id="progress-section" style="display:none; margin-bottom: 12px;">
      <label class="field-label">Progress</label>
      <div class="progress-list" id="progress-list"></div>
    </div>

    <div class="modal-actions" style="margin-top: 8px;">
      <button id="m-cancel">Cancel</button>
      <button class="primary" id="m-apply">Apply to selected</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Wire up radio groups
  function bindGroup(groupId) {
    const group = modal.querySelector("#" + groupId);
    let selected = "merge";
    group.querySelectorAll(".radio-option").forEach(opt => {
      opt.addEventListener("click", () => {
        group.querySelectorAll(".radio-option").forEach(o => o.classList.remove("selected"));
        opt.classList.add("selected");
        selected = opt.dataset.mode;
      });
    });
    return () => selected;
  }
  const getQbindMode = bindGroup("qbind-mode");
  const getMacroMode = bindGroup("macro-mode");

  // Select all / none
  modal.querySelector("#select-all").addEventListener("click", () => {
    modal.querySelectorAll('#char-checklist input[type=checkbox]').forEach(cb => cb.checked = true);
  });
  modal.querySelector("#select-none").addEventListener("click", () => {
    modal.querySelectorAll('#char-checklist input[type=checkbox]').forEach(cb => cb.checked = false);
  });

  function close() { document.body.removeChild(backdrop); }
  modal.querySelector("#m-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop && !applying) close(); });

  let applying = false;

  modal.querySelector("#m-apply").addEventListener("click", async () => {
    if (applying) return;
    const srcBinds = state.current.binds;
    const srcMacros = state.current.macros;
    const selected = Array.from(modal.querySelectorAll('#char-checklist input[type=checkbox]:checked')).map(cb => cb.dataset.name);
    if (selected.length === 0) {
      showToast("No characters selected.", "warn");
      return;
    }

    if (state.daocRunning) {
      const ok = await window.api.confirm({
        kind: "warning",
        title: "DAoC is running",
        message: "DAoC is currently running.",
        detail: "Saving now will work, but the game will overwrite your changes for the active character when you log out. Continue anyway?",
      });
      if (!ok) return;
    }

    const qMode = getQbindMode();
    const mMode = getMacroMode();

    applying = true;
    modal.querySelector("#m-cancel").disabled = true;
    modal.querySelector("#m-apply").disabled = true;
    modal.querySelector("#m-apply").textContent = "Applying…";

    const progressSection = modal.querySelector("#progress-section");
    const progressList = modal.querySelector("#progress-list");
    progressSection.style.display = "";
    progressList.innerHTML = "";
    const rows = {};
    for (const name of selected) {
      const row = document.createElement("div");
      row.className = "progress-row";
      row.innerHTML = `<span class="status-pending">⋯</span><span>${escapeHtml(name)}</span>`;
      progressList.appendChild(row);
      rows[name] = row;
    }

    let succeeded = 0;
    let failed = 0;
    for (const name of selected) {
      const row = rows[name];
      try {
        const r = await window.api.readFile(fullPath(name));
        if (!r.ok) throw new Error(r.error);
        const parsed = parseIni(r.text);
        const binds = getQbinds(parsed);
        const macros = getMacros(parsed);
        const result = mergeBindsMacros(srcBinds, srcMacros, binds, macros, qMode, mMode);
        const out = writeIni(parsed, result.binds, mMode === "skip" ? null : result.macros);
        // Always create backup in multi-apply mode for safety, regardless of session backup state
        const w = await window.api.writeFile(fullPath(name), out, true);
        if (!w.ok) throw new Error(w.error);
        // Update session-backup tracking so the user doesn't get a double-backup
        state.backedUpThisSession.add(name);
        row.innerHTML = `<span class="status-ok">✓</span><span>${escapeHtml(name)}</span>`;
        succeeded++;
      } catch (e) {
        row.innerHTML = `<span class="status-err">✕</span><span>${escapeHtml(name)} — ${escapeHtml(e.message)}</span>`;
        failed++;
      }
    }

    modal.querySelector("#m-apply").textContent = "Done";
    modal.querySelector("#m-cancel").disabled = false;
    modal.querySelector("#m-cancel").textContent = "Close";
    applying = false;
    showToast(`${succeeded} succeeded, ${failed} failed`);
  });
}

// ============================================================
// Profile actions
// ============================================================
async function deleteProfile(profile) {
  const ok = await window.api.confirm({
    kind: "warning",
    title: "Delete profile",
    message: `Delete profile "${profile.displayName}"?`,
    detail: "This deletes the JSON file from the eden folder.",
  });
  if (!ok) return;
  const r = await window.api.deleteFile(fullPath(profile.name));
  if (!r.ok) {
    showToast("Delete failed: " + r.error, "error");
    return;
  }
  showToast(`Deleted profile: ${profile.displayName}`);
  await loadFolder();
}

async function renameProfile(profile) {
  const newName = prompt("Rename profile to:", profile.displayName);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === profile.displayName) return;
  const safe = sanitizeProfileFilename(trimmed);
  if (!safe) {
    showToast("Name has no valid characters.", "error");
    return;
  }
  const newFilename = PROFILE_PREFIX + safe + ".json";
  if (newFilename.toLowerCase() !== profile.name.toLowerCase()) {
    const existing = state.profiles.find(p => p.name.toLowerCase() === newFilename.toLowerCase());
    if (existing) {
      const ok = await window.api.confirm({
        title: "Profile exists",
        message: `A profile named "${existing.displayName}" already exists. Overwrite?`,
      });
      if (!ok) return;
    }
  }
  const updatedData = { ...profile.data, name: trimmed };
  // Write new file
  const w = await window.api.writeFile(fullPath(newFilename), JSON.stringify(updatedData, null, 2), false);
  if (!w.ok) {
    showToast("Rename failed: " + w.error, "error");
    return;
  }
  // Delete old if name changed
  if (newFilename.toLowerCase() !== profile.name.toLowerCase()) {
    await window.api.deleteFile(fullPath(profile.name));
  }
  showToast(`Renamed to: ${trimmed}`);
  await loadFolder();
}

async function exportProfile(profile) {
  const r = await window.api.showSaveDialog(profile.name, JSON.stringify(profile.data, null, 2));
  if (r.ok) showToast(`Exported to ${r.savedPath}`);
  else if (r.error) showToast("Export failed: " + r.error, "error");
}

async function importProfile() {
  const r = await window.api.showOpenDialog();
  if (!r.ok) return;
  try {
    const data = JSON.parse(r.text);
    if (!data.binds || typeof data.binds !== "object") {
      throw new Error("Invalid profile: missing 'binds' object");
    }
    const displayName = data.name || r.name.replace(PROFILE_PREFIX, "").replace(/\.json$/i, "");
    const safe = sanitizeProfileFilename(displayName);
    const filename = PROFILE_PREFIX + safe + ".json";
    const existing = state.profiles.find(p => p.name.toLowerCase() === filename.toLowerCase());
    if (existing) {
      const ok = await window.api.confirm({
        title: "Profile exists",
        message: `A profile named "${existing.displayName}" already exists. Overwrite?`,
      });
      if (!ok) return;
    }
    const w = await window.api.writeFile(fullPath(filename), JSON.stringify(data, null, 2), false);
    if (!w.ok) throw new Error(w.error);
    showToast(`Imported profile: ${displayName}`);
    await loadFolder();
  } catch (e) {
    showToast("Import failed: " + e.message, "error");
  }
}

// ============================================================
// Helpers
// ============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

let toastTimer = null;
function showToast(msg, kind) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);
  const t = document.createElement("div");
  t.className = "toast" + (kind ? " " + kind : "");
  t.textContent = msg;
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), kind === "error" ? 5000 : 2500);
}

// Boot
init();
