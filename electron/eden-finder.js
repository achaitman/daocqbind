// Auto-detect the DAoC eden folder.
// Checks the standard install path, falls back to a couple alternatives,
// returns null if nothing is found (caller will then show a folder picker).

const fs = require("fs");
const path = require("path");
const os = require("os");

function getCandidatePaths() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const home = os.homedir();

  return [
    // Standard EA install
    path.join(appData, "Electronic Arts", "Dark Age of Camelot", "eden"),
    // Some installs use Local instead of Roaming
    path.join(localAppData, "Electronic Arts", "Dark Age of Camelot", "eden"),
    // Older Mythic-branded installs
    path.join(appData, "Mythic", "Dark Age of Camelot", "eden"),
    // User-relocated common spots
    path.join(home, "Documents", "DAoC-eden"),
    path.join("C:", "DAoC-eden"),
  ];
}

function looksLikeEdenFolder(folderPath) {
  // An eden folder should contain at least one .ini file that looks like a character ini.
  // Character INIs follow the pattern <name>-<level>.ini.
  try {
    if (!fs.existsSync(folderPath)) return false;
    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) return false;
    const entries = fs.readdirSync(folderPath);
    return entries.some(name => /^[A-Za-z]+-\d+\.ini$/i.test(name));
  } catch (e) {
    return false;
  }
}

function findEdenFolder() {
  for (const candidate of getCandidatePaths()) {
    if (looksLikeEdenFolder(candidate)) {
      return candidate;
    }
  }
  // Fallback: return the standard path even if it doesn't exist yet,
  // so the user knows where it would be.
  return null;
}

function getDefaultEdenPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Electronic Arts", "Dark Age of Camelot", "eden");
}

module.exports = {
  findEdenFolder,
  looksLikeEdenFolder,
  getDefaultEdenPath,
  getCandidatePaths,
};
