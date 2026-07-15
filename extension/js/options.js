import { clearAll, exportBackup, importBackup } from "./db.js";
import { DEFAULT_SETTINGS, getSettings, resetSettings, saveSettings } from "./settings.js";
import { downloadJson, fileToDataUrl } from "./utils.js";

const form = document.querySelector("#options-form");
const status = document.querySelector("#status");
const fontSelect = document.querySelector("#font-family-select");
let settings;
let backgroundDraft = "";
let statusTimer;

const NUMBER_FIELDS = ["columns", "gap", "dialSpace", "cardRadius", "padding", "thumbnailRatio", "fontSize"];
const BOOLEAN_FIELDS = [
  "verticalCenter", "darkTheme", "showAddButton", "showSearch", "showTitles", "showVisits",
  "keepActiveGroup", "highlight", "alwaysNewTab", "scrollLayout", "showContextMenu",
  "sidebarEnabled", "sidebarBookmarks", "sidebarHistory",
];
const STRING_FIELDS = [
  "sortMode", "shadowStyle", "titleAlign", "fontFamily", "fontStyle", "fontWeight",
  "dialBackground", "dialBackgroundHover", "dialBorder", "dialBorderHover", "titleColor", "titleColorHover",
  "customCss", "refreshThumbnails", "thumbnailQuality", "thumbnailFit", "backgroundColor", "backgroundUrl",
  "backgroundRepeat", "backgroundSize", "backgroundPosition",
];

function showStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#b42318" : "#333";
  status.classList.add("visible");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.classList.remove("visible"), 2200);
}

function populate(values) {
  NUMBER_FIELDS.forEach((name) => { form.elements[name].value = values[name]; });
  BOOLEAN_FIELDS.forEach((name) => { form.elements[name].checked = Boolean(values[name]); });
  STRING_FIELDS.forEach((name) => { form.elements[name].value = values[name] ?? ""; });
  fontSelect.value = [...fontSelect.options].some((option) => option.value === values.fontFamily)
    ? values.fontFamily
    : "";
  backgroundDraft = values.backgroundImage || "";
}

function valuesFromForm() {
  const values = {};
  NUMBER_FIELDS.forEach((name) => { values[name] = Number(form.elements[name].value); });
  BOOLEAN_FIELDS.forEach((name) => { values[name] = form.elements[name].checked; });
  STRING_FIELDS.forEach((name) => { values[name] = form.elements[name].value; });
  values.refreshThumbnails = Number(values.refreshThumbnails);
  values.backgroundImage = values.backgroundUrl ? "" : backgroundDraft;
  values.theme = values.darkTheme ? "dark" : "light";
  return values;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    settings = await saveSettings(valuesFromForm());
    showStatus("设置已保存");
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector("#background-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return showStatus("请选择小于 10 MB 的图片", true);
  backgroundDraft = await fileToDataUrl(file);
  form.elements.backgroundUrl.value = "";
  showStatus("已选择背景图片");
});

document.querySelector("#clear-background").addEventListener("click", () => {
  backgroundDraft = "";
  form.elements.backgroundUrl.value = "";
  document.querySelector("#background-file").value = "";
  showStatus("背景图片已移除");
});

fontSelect.addEventListener("change", () => {
  if (fontSelect.value) form.elements.fontFamily.value = fontSelect.value;
});

document.querySelector("#load-system-fonts").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (typeof window.queryLocalFonts !== "function") {
    showStatus("当前 Chrome 版本不支持读取系统字体，可直接输入字体名称", true);
    return;
  }
  button.disabled = true;
  try {
    const fonts = await window.queryLocalFonts();
    const families = [...new Set(fonts.map((font) => font.family).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
    fontSelect.replaceChildren(
      new Option("选择字体", ""),
      ...families.map((family) => new Option(family, family)),
    );
    fontSelect.value = families.includes(form.elements.fontFamily.value) ? form.elements.fontFamily.value : "";
    showStatus(`已读取 ${families.length} 个系统字体，可从下拉列表选择`);
  } catch (error) {
    showStatus(error.name === "NotAllowedError" ? "未授权读取系统字体，也可以直接输入字体名称" : error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#reset-settings").addEventListener("click", async () => {
  if (!confirm("确定恢复所有默认设置吗？")) return;
  settings = await resetSettings();
  populate(settings);
  showStatus("已恢复默认设置");
});

document.querySelector("#export-backup").addEventListener("click", async () => {
  const backup = await exportBackup();
  backup.settings = await getSettings();
  downloadJson(`speed-dial-2-${new Date().toISOString().slice(0, 10)}.json`, backup);
  showStatus("备份已导出");
});

document.querySelector("#import-backup").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!confirm("导入会替换现有的分组、网站和设置。确定继续吗？")) return;
    await importBackup(backup);
    settings = backup.settings ? await saveSettings(backup.settings) : await getSettings();
    populate(settings);
    await chrome.runtime.sendMessage({ type: "refresh-context-menus" });
    showStatus("备份已导入");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#export-bookmarks").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "export-bookmarks" });
  showStatus(response?.ok ? "已导出到 Chrome 书签" : response?.error || "导出失败", !response?.ok);
});

document.querySelector("#clear-data").addEventListener("click", async () => {
  if (!confirm("确定清空所有分组、网站、缩略图和访问统计吗？")) return;
  await clearAll();
  await chrome.runtime.sendMessage({ type: "refresh-context-menus" });
  showStatus("数据已清空");
});

function selectTab(tab) {
  document.querySelectorAll("#options-navigation [data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
  history.replaceState(null, "", `#${tab}`);
}

document.querySelector("#options-navigation").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (button) selectTab(button.dataset.tab);
});

async function init() {
  settings = await getSettings();
  populate({ ...DEFAULT_SETTINGS, ...settings });
  const requestedTab = location.hash.slice(1);
  selectTab(["general", "design", "sidebars", "dials", "importexport"].includes(requestedTab) ? requestedTab : "general");
}

init().catch((error) => showStatus(error.message, true));
