export const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: 2,
  columns: 3,
  gap: 20,
  dialSpace: 90,
  padding: 4,
  thumbnailRatio: 1,
  verticalCenter: true,
  scrollLayout: true,
  showAddButton: true,
  showSearch: true,
  showTitles: true,
  showVisits: false,
  titleAlign: "center",
  sortMode: "manual",
  keepActiveGroup: true,
  alwaysNewTab: false,
  highlight: false,
  refreshThumbnails: 0,
  thumbnailQuality: "high",
  thumbnailFit: "contain",
  showContextMenu: true,
  sidebarEnabled: false,
  sidebarBookmarks: false,
  sidebarHistory: false,
  theme: "light",
  darkTheme: false,
  cardRadius: 4,
  shadowStyle: "none",
  fontSize: 11,
  fontFamily: "Helvetica, Arial, sans-serif",
  fontStyle: "normal",
  fontWeight: "normal",
  backgroundColor: "#fcfcfc",
  backgroundImage: "",
  backgroundUrl: "",
  backgroundRepeat: "no-repeat",
  backgroundSize: "auto",
  backgroundPosition: "left top",
  dialBackground: "#ffffff",
  dialBackgroundHover: "#ffffff",
  dialBorder: "#dddddd",
  dialBorderHover: "#cccccc",
  titleColor: "#8c7e7e",
  titleColorHover: "#333333",
  customCss: "",

  // Values used by the provisional UI are retained for lossless migration, but
  // they no longer define the original default appearance.
  accent: "#4285f4",
  backgroundBlur: 0,
  cardOpacity: 100,
  shadowStrength: 0,
  fontScale: 100,
  cardRatio: 1,
});

const STORAGE_KEY = "appearance";

function migrateSettings(stored = {}) {
  const migrated = { ...stored };
  if (migrated.thumbnailRatio == null && migrated.cardRatio != null) {
    migrated.thumbnailRatio = Number(migrated.cardRatio) || 1;
  }
  if (migrated.darkTheme == null) migrated.darkTheme = migrated.theme === "dark";
  if (migrated.gap == null && migrated.dialSpacing != null) migrated.gap = migrated.dialSpacing;
  migrated.settingsVersion = 2;
  return { ...DEFAULT_SETTINGS, ...migrated };
}

export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const next = migrateSettings(result[STORAGE_KEY]);
  if (result[STORAGE_KEY]?.settingsVersion !== 2) {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  }
  return next;
}

export async function saveSettings(changes) {
  const current = await getSettings();
  const next = migrateSettings({ ...current, ...changes });
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function resetSettings() {
  const next = { ...DEFAULT_SETTINGS };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function applySettings(settings, root = document.documentElement) {
  const dark = Boolean(settings.darkTheme || settings.theme === "dark");
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.shadow = ["box", "drop", "glow"].includes(settings.shadowStyle) ? settings.shadowStyle : "none";
  root.style.setProperty("--dial-columns", settings.columns);
  root.style.setProperty("--dial-gap", `${settings.gap}px`);
  root.style.setProperty("--dial-space", `${settings.dialSpace}%`);
  root.style.setProperty("--dial-padding", `${settings.padding}px`);
  root.style.setProperty("--card-radius", `${settings.cardRadius}px`);
  root.style.setProperty("--shadow-alpha", settings.shadowStyle === "none" ? 0 : Math.max(.08, settings.shadowStrength / 300));
  root.style.setProperty("--accent", settings.accent);
  root.style.setProperty("--background-color", settings.backgroundColor);
  root.style.setProperty("--card-opacity", 1);
  root.style.setProperty("--font-scale", settings.fontScale / 100);
  root.style.setProperty("--dial-background", settings.dialBackground);
  root.style.setProperty("--dial-background-hover", settings.dialBackgroundHover);
  root.style.setProperty("--dial-border", settings.dialBorder);
  root.style.setProperty("--dial-border-hover", settings.dialBorderHover);
  root.style.setProperty("--title-color", settings.titleColor);
  root.style.setProperty("--title-color-hover", settings.titleColorHover);
  root.style.setProperty("--title-align", settings.titleAlign);
  root.style.setProperty("--dial-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--dial-font-family", settings.fontFamily);
  root.style.setProperty("--dial-font-style", settings.fontStyle);
  root.style.setProperty("--dial-font-weight", settings.fontWeight);
  root.style.setProperty("--thumbnail-fit", settings.thumbnailFit === "cover" ? "cover" : "contain");
  root.classList.toggle("vertical-center", Boolean(settings.verticalCenter));
  root.classList.toggle("hide-titles", !settings.showTitles);
  root.classList.toggle("hide-visits", !settings.showVisits);
  root.classList.toggle("hide-search", !settings.showSearch);
  root.classList.toggle("scroll-layout", Boolean(settings.scrollLayout));
  root.classList.toggle("sidebar-enabled", Boolean(settings.sidebarEnabled));

  const background = settings.backgroundImage || settings.backgroundUrl;
  root.style.setProperty("--user-background", background ? `url(${JSON.stringify(background)})` : "none");
  root.style.setProperty("--background-repeat", settings.backgroundRepeat);
  root.style.setProperty("--background-size", settings.backgroundSize);
  root.style.setProperty("--background-position", settings.backgroundPosition);

  const doc = root.ownerDocument;
  if (doc) {
    let style = doc.getElementById("user-custom-css");
    if (!style) {
      style = doc.createElement("style");
      style.id = "user-custom-css";
      doc.head.append(style);
    }
    style.textContent = settings.customCss || "";
  }
}
