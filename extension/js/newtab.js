import {
  bootstrap,
  clearAll,
  createDial,
  createGroup,
  deleteDial,
  deleteGroup,
  exportBackup,
  getDials,
  getGroups,
  getImage,
  importBackup,
  moveDial,
  reorderDials,
  reorderGroups,
  saveImage,
  updateDial,
  updateGroup,
  visitDial,
} from "./db.js";
import { applySettings, DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings.js";
import { initSidebar } from "./sidebar.js";
import {
  PERIOD_LABELS,
  debounce,
  downloadJson,
  faviconUrl,
  fileToDataUrl,
  formatRelativeTime,
  hostname,
  hueFor,
  initials,
  normalizeUrl,
} from "./utils.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  groups: [],
  dials: [],
  settings: null,
  activeGroupId: null,
  query: "",
  objectUrls: [],
  dragDialId: null,
  dragGroupId: null,
  backgroundDraft: null,
  settingsDraftBase: null,
  sidebarController: null,
  contextTarget: null,
};

const elements = {
  groupTabs: $("#group-tabs"),
  dialGrid: $("#dial-grid"),
  emptyState: $("#empty-state"),
  stageTitle: $("#stage-title"),
  stageEyebrow: $("#stage-eyebrow"),
  stageCount: $("#stage-count"),
  search: $("#search-input"),
  dialDialog: $("#dial-dialog"),
  dialForm: $("#dial-form"),
  groupDialog: $("#group-dialog"),
  groupForm: $("#group-form"),
  settingsDialog: $("#settings-dialog"),
  settingsForm: $("#settings-form"),
  statsDialog: $("#stats-dialog"),
  toast: $("#toast"),
};

const SETTINGS_NUMBER_FIELDS = ["columns", "gap", "dialSpace", "cardRadius", "padding", "thumbnailRatio", "fontSize"];
const SETTINGS_BOOLEAN_FIELDS = [
  "verticalCenter", "darkTheme", "showAddButton", "showSearch", "showTitles", "showVisits",
  "keepActiveGroup", "highlight", "alwaysNewTab", "scrollLayout", "showContextMenu",
  "sidebarEnabled", "sidebarBookmarks", "sidebarHistory",
];
const SETTINGS_STRING_FIELDS = [
  "sortMode", "shadowStyle", "titleAlign", "fontFamily", "fontStyle", "fontWeight",
  "dialBackground", "dialBackgroundHover", "dialBorder", "dialBorderHover", "titleColor", "titleColorHover",
  "customCss", "refreshThumbnails", "thumbnailQuality", "thumbnailFit", "backgroundColor", "backgroundUrl",
  "backgroundRepeat", "backgroundSize", "backgroundPosition",
];

let toastTimer;
let settingsStatusTimer;
function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2400);
}

function showSettingsStatus(message, isError = false) {
  const status = $("#settings-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
  clearTimeout(settingsStatusTimer);
  settingsStatusTimer = setTimeout(() => { status.textContent = ""; }, 3000);
}

function notifyBackground() {
  chrome.runtime.sendMessage({ type: "refresh-context-menus" }).catch(() => {});
}

async function refreshData({ preserveGroup = true } = {}) {
  [state.groups, state.dials] = await Promise.all([getGroups(), getDials()]);
  const remembered = preserveGroup
    ? state.activeGroupId || (state.settings.keepActiveGroup ? localStorage.getItem("activeGroupId") : null)
    : null;
  state.activeGroupId = state.groups.some((group) => group.id === remembered)
    ? remembered
    : state.groups[0]?.id || null;
  if (state.activeGroupId && state.settings.keepActiveGroup) localStorage.setItem("activeGroupId", state.activeGroupId);
  if (!state.settings.keepActiveGroup) localStorage.removeItem("activeGroupId");
  render();
}

function render() {
  renderGroups();
  renderDials();
}

function renderGroups() {
  elements.groupTabs.replaceChildren();
  state.groups.forEach((group) => {
    const tab = document.createElement("div");
    tab.className = `group-tab${group.id === state.activeGroupId ? " active" : ""}`;
    tab.dataset.groupId = group.id;
    tab.draggable = group.id !== "default";
    tab.style.setProperty("--group-color", group.color);

    const label = document.createElement("button");
    label.type = "button";
    label.className = "group-label";
    label.textContent = group.name;
    label.dataset.action = "select-group";

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "group-menu";
    menu.title = `编辑分组：${group.name}`;
    menu.dataset.action = "edit-group";
    menu.innerHTML = '<svg><use href="#i-more"/></svg>';
    tab.append(label, menu);
    elements.groupTabs.append(tab);
  });
}

function sortedVisibleDials() {
  let dials;
  if (state.query) {
    const query = state.query.toLocaleLowerCase();
    dials = state.dials.filter((dial) =>
      `${dial.title} ${dial.url} ${hostname(dial.url)}`.toLocaleLowerCase().includes(query),
    );
  } else {
    dials = state.dials.filter((dial) => dial.groupId === state.activeGroupId);
  }

  if (state.settings.sortMode === "visits") {
    return [...dials].sort((a, b) => (b.visits || 0) - (a.visits || 0));
  }
  if (state.settings.sortMode === "title") {
    return [...dials].sort((a, b) => a.title.localeCompare(b.title));
  }
  return [...dials].sort((a, b) => a.order - b.order);
}

function computeDialGeometry(itemCount) {
  const columns = Math.max(2, Math.min(20, Number(state.settings.columns) || 3));
  const spacing = Math.max(0, Number(state.settings.gap) || 0);
  const widthModifier = Math.max(10, Math.min(100, Number(state.settings.dialSpace) || 90)) / 100;
  const padding = Math.max(0, Number(state.settings.padding) || 0);
  let ratio = (screen.height - 130) / screen.width;
  ratio = Math.max(.55, Math.min(.65, ratio));
  ratio *= Math.max(.5, Math.min(2, Number(state.settings.thumbnailRatio) || 1));

  let dialWidth = Math.floor((widthModifier * innerWidth - columns * spacing) / columns);
  dialWidth = Math.max(90, Math.min(360, dialWidth));
  const rows = Math.max(1, Math.ceil(itemCount / columns));
  if (!state.settings.scrollLayout && itemCount) {
    const availableHeight = innerHeight - 96;
    const maxRowHeight = (availableHeight - Math.max(0, rows - 1) * spacing) / rows;
    const maxWidth = Math.floor((maxRowHeight - 28 - padding) / ratio + 2 * padding);
    dialWidth = Math.max(90, Math.min(dialWidth, maxWidth));
  }
  const thumbnailHeight = Math.max(60, Math.floor((dialWidth - 2 * padding) * ratio + padding));
  document.documentElement.style.setProperty("--dial-columns", columns);
  document.documentElement.style.setProperty("--dial-width", `${dialWidth}px`);
  document.documentElement.style.setProperty("--dial-thumb-height", `${thumbnailHeight}px`);
  elements.dialGrid.style.width = `${columns * dialWidth + Math.max(0, columns - 1) * spacing}px`;
}

function revokeObjectUrls() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
}

function makeDefaultThumbnail(dial) {
  const fallback = document.createElement("div");
  fallback.className = "default-thumb";
  fallback.style.setProperty("--site-hue", hueFor(dial.url));
  const monogram = document.createElement("span");
  monogram.className = "site-monogram";
  monogram.textContent = initials(dial.url);

  const icon = document.createElement("img");
  icon.alt = "";
  icon.src = faviconUrl(dial.url);
  icon.addEventListener("load", () => {
    monogram.textContent = "";
    monogram.append(icon);
  }, { once: true });
  icon.addEventListener("error", () => icon.remove(), { once: true });
  fallback.append(monogram);
  return fallback;
}

async function hydrateThumbnail(container, dial) {
  const thumbnail = dial.thumbnail || { type: "default" };
  if (thumbnail.type === "url" && thumbnail.url) {
    const image = document.createElement("img");
    image.className = "dial-image";
    image.alt = "";
    image.src = thumbnail.url;
    image.addEventListener("error", () => image.replaceWith(makeDefaultThumbnail(dial)), { once: true });
    container.append(image);
    return;
  }
  if (["upload", "screenshot"].includes(thumbnail.type) && thumbnail.imageId) {
    const stored = await getImage(thumbnail.imageId);
    if (stored?.blob && container.isConnected) {
      const image = document.createElement("img");
      const objectUrl = URL.createObjectURL(stored.blob);
      state.objectUrls.push(objectUrl);
      image.className = "dial-image";
      image.alt = "";
      image.src = objectUrl;
      container.append(image);
      return;
    }
  }
  container.append(makeDefaultThumbnail(dial));
}

function renderDials() {
  revokeObjectUrls();
  elements.dialGrid.replaceChildren();
  const visible = sortedVisibleDials();
  const hasAddTile = !state.query && visible.length > 0 && state.settings.showAddButton;
  computeDialGeometry(visible.length + (hasAddTile ? 1 : 0));
  const activeGroup = state.groups.find((group) => group.id === state.activeGroupId);
  elements.stageTitle.textContent = state.query ? "搜索结果" : activeGroup?.name || "首页";
  elements.stageEyebrow.textContent = state.query ? `正在搜索“${state.query}”` : "快速拨号";
  elements.stageCount.textContent = `${visible.length} 个网站`;
  $("#open-group").hidden = Boolean(state.query) || visible.length === 0;
  $("#footer-sort").textContent = state.settings.sortMode === "manual"
    ? "手动排序"
    : state.settings.sortMode === "visits" ? "按访问次数" : "按名称排序";

  const trulyEmpty = !state.query && visible.length === 0;
  elements.emptyState.hidden = !trulyEmpty;
  elements.dialGrid.hidden = trulyEmpty;

  const period = (() => {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return "morning";
    if (hour >= 12 && hour < 18) return "afternoon";
    if (hour >= 18) return "evening";
    return "night";
  })();
  const frequentIds = new Set(state.settings.highlight
    ? [...visible]
      .filter((dial) => (dial.visitsByPeriod?.[period] || 0) > 0)
      .sort((a, b) => (b.visitsByPeriod?.[period] || 0) - (a.visitsByPeriod?.[period] || 0))
      .slice(0, 3)
      .map((dial) => dial.id)
    : []);

  visible.forEach((dial, index) => {
    const card = document.createElement("article");
    card.className = `dial-card${frequentIds.has(dial.id) ? " frequent" : ""}`;
    card.dataset.dialId = dial.id;
    card.draggable = !state.query && state.settings.sortMode === "manual";

    const link = document.createElement("a");
    link.className = "dial-link";
    link.dataset.action = "open-dial";
    link.href = dial.url;
    link.title = dial.title;

    const visual = document.createElement("span");
    visual.className = "dial-visual";
    const number = document.createElement("span");
    number.className = "dial-index";
    number.textContent = String(index + 1).padStart(2, "0");
    visual.append(number);
    hydrateThumbnail(visual, dial).catch(() => visual.append(makeDefaultThumbnail(dial)));

    const meta = document.createElement("span");
    meta.className = "dial-meta";
    const title = document.createElement("span");
    title.className = "dial-title";
    const strong = document.createElement("strong");
    strong.textContent = dial.title;
    const small = document.createElement("small");
    small.textContent = hostname(dial.url);
    title.append(strong, small);
    const visits = document.createElement("span");
    visits.className = "visit-count";
    visits.textContent = String(dial.visits || 0);
    meta.append(title, visits);
    link.append(visual, meta);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "card-menu";
    menu.dataset.action = "edit-dial";
    menu.title = `编辑 ${dial.title}`;
    menu.innerHTML = '<svg><use href="#i-more"/></svg>';
    card.append(link, menu);
    elements.dialGrid.append(card);
  });

  if (hasAddTile) {
    const addTile = document.createElement("button");
    addTile.type = "button";
    addTile.className = "add-dial-tile";
    addTile.title = "添加网站";
    addTile.innerHTML = '<img src="images/newtab.first-dial-small.svg" width="64" height="64" alt="添加网站">';
    addTile.addEventListener("click", () => openDialEditor());
    elements.dialGrid.append(addTile);
  }
}

function openDialEditor(dial = null, defaults = {}) {
  const form = elements.dialForm;
  form.reset();
  form.elements.id.value = dial?.id || "";
  form.elements.title.value = dial?.title || defaults.title || "";
  form.elements.url.value = dial?.url || defaults.url || "";
  const select = form.elements.groupId;
  select.replaceChildren(...state.groups.map((group) => new Option(group.name, group.id)));
  select.value = dial?.groupId || defaults.groupId || state.activeGroupId;
  const storedType = dial?.thumbnail?.type || "screenshot";
  const type = storedType === "pending-capture" ? "screenshot" : storedType;
  form.elements.thumbnailType.value = ["default", "screenshot", "upload", "url"].includes(type) ? type : "default";
  form.elements.imageUrl.value = dial?.thumbnail?.url || "";
  $("#dial-dialog-title").textContent = dial ? "编辑网站" : "添加网站";
  $("#delete-dial").hidden = !dial;
  updateThumbnailFields();
  elements.dialDialog.showModal();
  setTimeout(() => form.elements.title.focus(), 30);
}

function updateThumbnailFields() {
  const type = elements.dialForm.elements.thumbnailType.value;
  $$('[data-thumbnail-field]').forEach((field) => {
    field.hidden = field.dataset.thumbnailField !== type;
  });
}

async function saveDialFromForm(event) {
  event.preventDefault();
  const form = elements.dialForm;
  const id = form.elements.id.value;
  const url = normalizeUrl(form.elements.url.value);
  const thumbnailType = form.elements.thumbnailType.value;
  const captureAfterSave = thumbnailType === "screenshot";
  let thumbnail = { type: thumbnailType };
  const currentDial = id ? state.dials.find((dial) => dial.id === id) : null;

  if (thumbnailType === "screenshot") {
    thumbnail = currentDial?.thumbnail || { type: "default" };
  } else if (thumbnailType === "url") {
    const imageUrl = String(form.elements.imageUrl.value || "").trim();
    if (!/^https?:\/\//i.test(imageUrl)) throw new Error("图片网址必须以 http:// 或 https:// 开头。");
    thumbnail.url = imageUrl;
  } else if (thumbnailType === "upload") {
    const file = form.elements.imageFile.files[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024) throw new Error("请选择小于 8 MB 的图片。");
      thumbnail.imageId = await saveImage(file);
    } else if (id) {
      if (currentDial?.thumbnail?.type === "upload") thumbnail = currentDial.thumbnail;
      else throw new Error("请选择要上传的图片。");
    } else {
      throw new Error("请选择要上传的图片。");
    }
  }

  const values = {
    title: form.elements.title.value.trim(),
    url,
    groupId: form.elements.groupId.value,
    thumbnail,
  };
  const savedDial = id ? await updateDial(id, values) : await createDial(values);
  state.activeGroupId = values.groupId;
  elements.dialDialog.close();
  await refreshData();
  notifyBackground();
  if (captureAfterSave) {
    toast("正在打开网页并生成截图…");
    const sourceTab = await chrome.tabs.getCurrent();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "capture-dial-automatically",
        dialId: savedDial.id,
        url,
        sourceTabId: sourceTab?.id,
        windowId: sourceTab?.windowId,
        quality: state.settings.thumbnailQuality,
      });
      if (!response?.ok) throw new Error(response?.error || "网页截图失败。");
    } catch (error) {
      await refreshData();
      throw error;
    }
    await refreshData();
    toast("网页截图已保存");
    return;
  }
  toast(id ? "网站已更新" : "网站已添加");
}

async function openTopSitesPicker() {
  const dialog = $("#top-sites-dialog");
  const list = $("#top-sites-list");
  const sites = await chrome.topSites.get();
  list.replaceChildren();
  sites.filter((site) => /^https?:\/\//i.test(site.url)).forEach((site, index) => {
    const label = document.createElement("label");
    label.className = "top-site-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "topSite";
    input.value = String(index);
    const icon = document.createElement("img");
    icon.src = faviconUrl(site.url, 32);
    icon.alt = "";
    const title = document.createElement("span");
    title.textContent = site.title || hostname(site.url);
    label.append(input, icon, title);
    label.dataset.url = site.url;
    label.dataset.title = site.title || hostname(site.url);
    list.append(label);
  });
  dialog.showModal();
}

function openGroupEditor(group = null) {
  const form = elements.groupForm;
  form.reset();
  form.elements.id.value = group?.id || "";
  form.elements.name.value = group?.name || "";
  $("#group-dialog-title").textContent = group ? "编辑分组" : "新建分组";
  $("#delete-group").hidden = !group || group.id === "default";
  elements.groupDialog.showModal();
  setTimeout(() => form.elements.name.focus(), 30);
}

async function saveGroupFromForm(event) {
  event.preventDefault();
  const form = elements.groupForm;
  const id = form.elements.id.value;
  const values = { name: form.elements.name.value.trim() };
  const group = id ? await updateGroup(id, values) : await createGroup(values);
  state.activeGroupId = group.id;
  elements.groupDialog.close();
  await refreshData();
  notifyBackground();
  toast(id ? "分组已更新" : "分组已创建");
}

async function openDial(dial, { forceNewTab = false } = {}) {
  await visitDial(dial.id);
  const refreshEvery = Number(state.settings.refreshThumbnails) || 0;
  if (refreshEvery > 0 && ((dial.visits || 0) + 1) % refreshEvery === 0) {
    try {
      await captureExistingDial(dial);
    } catch (error) {
      toast(`缩略图更新失败：${error.message}`);
    }
  }
  if (forceNewTab || state.settings.alwaysNewTab) {
    await chrome.tabs.create({ url: dial.url, active: true });
    return;
  }
  const currentTab = await chrome.tabs.getCurrent();
  await chrome.tabs.update(currentTab?.id, { url: dial.url });
}

async function openAllGroup(groupId) {
  const dials = state.dials.filter((dial) => dial.groupId === groupId);
  for (const dial of dials) {
    await visitDial(dial.id);
    await chrome.tabs.create({ url: dial.url, active: false });
  }
  return dials.length;
}

function renderStats() {
  const totalVisits = state.dials.reduce((sum, dial) => sum + (dial.visits || 0), 0);
  const visited = state.dials.filter((dial) => dial.visits > 0).length;
  const periods = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  state.dials.forEach((dial) => Object.keys(periods).forEach((key) => periods[key] += dial.visitsByPeriod?.[key] || 0));
  const maxPeriod = Math.max(1, ...Object.values(periods));
  const top = [...state.dials].filter((dial) => (dial.visits || 0) > 0)
    .sort((a, b) => (b.visits || 0) - (a.visits || 0)).slice(0, 8);
  const content = $("#stats-content");
  content.replaceChildren();

  const summary = document.createElement("section");
  summary.className = "stats-summary";
  [[state.dials.length, "已保存网站"], [totalVisits, "累计打开次数"], [visited, "访问过的网站"]].forEach(([value, label]) => {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    const strong = document.createElement("strong"); strong.textContent = value;
    const span = document.createElement("span"); span.textContent = label;
    tile.append(strong, span); summary.append(tile);
  });

  const chart = document.createElement("section");
  chart.className = "period-chart";
  Object.entries(periods).forEach(([period, value]) => {
    const row = document.createElement("div"); row.className = "period-row";
    const label = document.createElement("span"); label.textContent = PERIOD_LABELS[period];
    const bar = document.createElement("span"); bar.className = "period-bar";
    const fill = document.createElement("i"); fill.style.width = `${(value / maxPeriod) * 100}%`; bar.append(fill);
    const count = document.createElement("span"); count.textContent = value;
    row.append(label, bar, count); chart.append(row);
  });

  const list = document.createElement("section"); list.className = "top-list";
  if (!top.length) list.innerHTML = '<div class="empty-note">从快速拨号打开网站后，这里会显示访问统计。</div>'; 
  top.forEach((dial, index) => {
    const row = document.createElement("div"); row.className = "top-row";
    const rank = document.createElement("span"); rank.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("span");
    const strong = document.createElement("strong"); strong.textContent = dial.title;
    const small = document.createElement("small"); small.textContent = `上次打开：${formatRelativeTime(dial.lastVisitedAt)}`;
    copy.append(strong, small);
    const value = document.createElement("span"); value.textContent = `${dial.visits || 0}×`;
    row.append(rank, copy, value); list.append(row);
  });
  content.append(summary, chart, list);
}

function selectSettingsTab(tab) {
  $$('[data-settings-tab]', elements.settingsForm).forEach((button) => {
    button.classList.toggle("active", button.dataset.settingsTab === tab);
  });
  $$('[data-settings-panel]', elements.settingsForm).forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== tab;
  });
  elements.settingsForm.querySelector(".settings-panels").scrollTop = 0;
}

function updateSettingsRange(range, value = range.value) {
  range.value = value;
  const min = Number(range.min);
  const max = Number(range.max);
  const progress = max > min ? (Number(range.value) - min) / (max - min) * 100 : 0;
  range.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, progress))}%`);
}

function populateSettingsForm(settings = state.settings) {
  const form = elements.settingsForm;
  SETTINGS_NUMBER_FIELDS.forEach((name) => { form.elements[name].value = settings[name]; });
  $$('[data-setting-range]', form).forEach((range) => {
    updateSettingsRange(range, form.elements[range.dataset.settingRange].value);
  });
  SETTINGS_BOOLEAN_FIELDS.forEach((name) => { form.elements[name].checked = Boolean(settings[name]); });
  SETTINGS_STRING_FIELDS.forEach((name) => { form.elements[name].value = settings[name] ?? ""; });
  state.backgroundDraft = settings.backgroundImage || "";
  state.settingsDraftBase = settings;
  $("#settings-background-file").value = "";
}

function settingsFromForm() {
  const form = elements.settingsForm;
  const settings = {};
  SETTINGS_NUMBER_FIELDS.forEach((name) => { settings[name] = Number(form.elements[name].value); });
  SETTINGS_BOOLEAN_FIELDS.forEach((name) => { settings[name] = form.elements[name].checked; });
  SETTINGS_STRING_FIELDS.forEach((name) => { settings[name] = form.elements[name].value; });
  settings.refreshThumbnails = Number(settings.refreshThumbnails);
  settings.backgroundImage = settings.backgroundUrl ? "" : state.backgroundDraft;
  settings.theme = settings.darkTheme ? "dark" : "light";
  return { ...state.settingsDraftBase, ...settings };
}

function openSettingsDialog(tab = "general") {
  populateSettingsForm();
  $("#settings-status").textContent = "";
  selectSettingsTab(tab);
  elements.settingsDialog.showModal();
}

async function saveSettingsForm(event) {
  event.preventDefault();
  state.settings = await saveSettings(settingsFromForm());
  applySettings(state.settings);
  state.sidebarController?.refresh(state.settings);
  elements.settingsDialog.close();
  renderDials();
  toast("设置已保存");
}

function hideContextMenus() {
  $$(".context-menu").forEach((menu) => { menu.hidden = true; });
  state.contextTarget = null;
}

function showContextMenu(menu, event, target) {
  hideContextMenus();
  state.contextTarget = target;
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(event.clientX, innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, innerHeight - rect.height - 4))}px`;
}

async function captureExistingDial(dial) {
  toast("正在生成缩略图…");
  const sourceTab = await chrome.tabs.getCurrent();
  const response = await chrome.runtime.sendMessage({
    type: "capture-dial-automatically",
    dialId: dial.id,
    url: dial.url,
    sourceTabId: sourceTab?.id,
    windowId: sourceTab?.windowId,
    quality: state.settings.thumbnailQuality,
  });
  if (!response?.ok) throw new Error(response?.error || "生成缩略图失败。");
  await refreshData();
  toast("缩略图已更新");
}

async function runContextCommand(command) {
  const target = state.contextTarget;
  const dial = target?.dialId ? state.dials.find((item) => item.id === target.dialId) : null;
  const group = target?.groupId ? state.groups.find((item) => item.id === target.groupId) : null;
  hideContextMenus();
  if (command === "add-dial") return openDialEditor();
  if (command === "add-group") return openGroupEditor();
  if (command === "settings") return openSettingsDialog();
  if (command === "statistics") { location.href = chrome.runtime.getURL("statistics.html"); return; }
  if (command === "open-new-tab" && dial) return openDial(dial, { forceNewTab: true });
  if (command === "edit-dial" && dial) return openDialEditor(dial);
  if (command === "delete-dial" && dial) {
    if (confirm("确定删除这个网站吗？")) { await deleteDial(dial.id); await refreshData(); notifyBackground(); }
    return;
  }
  if (command === "refresh-thumbnail" && dial) return captureExistingDial(dial);
  if (command === "open-group" && group) return openAllGroup(group.id);
  if (command === "edit-group" && group) return openGroupEditor(group);
  if (command === "delete-group" && group && group.id !== "default") {
    if (confirm("删除分组也会删除其中的所有网站。确定继续吗？")) {
      await deleteGroup(group.id); state.activeGroupId = "default"; await refreshData(); notifyBackground();
    }
  }
}

function bindEvents() {
  $("#add-dial").addEventListener("click", () => openDialEditor());
  $("#empty-add").addEventListener("click", () => openDialEditor());
  $("#add-group").addEventListener("click", () => openGroupEditor());
  $("#open-group").addEventListener("click", async () => {
    const count = await openAllGroup(state.activeGroupId);
    if (count) toast(`已打开 ${count} 个网站`);
  });
  $("#open-stats")?.addEventListener("click", () => { renderStats(); elements.statsDialog.showModal(); });
  $("#open-settings").addEventListener("click", () => openSettingsDialog());
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

  elements.search.addEventListener("input", debounce(() => {
    const query = elements.search.value.trim();
    state.query = query.length > 1 ? query : "";
    renderDials();
  }, 80));
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      event.preventDefault(); elements.search.focus();
    }
  });

  elements.groupTabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".group-tab");
    if (!tab) return;
    const group = state.groups.find((item) => item.id === tab.dataset.groupId);
    if (event.target.closest('[data-action="edit-group"]')) openGroupEditor(group);
    else {
      state.activeGroupId = group.id;
      if (state.settings.keepActiveGroup) localStorage.setItem("activeGroupId", group.id);
      state.query = ""; elements.search.value = ""; render();
    }
  });
  elements.groupTabs.addEventListener("auxclick", async (event) => {
    if (event.button !== 1) return;
    const tab = event.target.closest(".group-tab");
    if (!tab) return;
    event.preventDefault();
    await openAllGroup(tab.dataset.groupId);
  });

  elements.dialGrid.addEventListener("click", async (event) => {
    const card = event.target.closest(".dial-card");
    if (!card) return;
    const dial = state.dials.find((item) => item.id === card.dataset.dialId);
    if (event.target.closest('[data-action="edit-dial"]')) {
      event.preventDefault();
      openDialEditor(dial);
      return;
    }
    if (event.target.closest('[data-action="open-dial"]')) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        await visitDial(dial.id);
        return;
      }
      event.preventDefault();
      await openDial(dial);
    }
  });
  elements.dialGrid.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    const card = event.target.closest(".dial-card");
    const dial = state.dials.find((item) => item.id === card?.dataset.dialId);
    if (dial) visitDial(dial.id).catch(console.error);
  });

  elements.dialForm.addEventListener("change", (event) => {
    if (event.target.name === "thumbnailType") updateThumbnailFields();
  });
  elements.dialForm.addEventListener("submit", (event) => saveDialFromForm(event).catch((error) => toast(error.message)));
  $("#delete-dial").addEventListener("click", async () => {
    const id = elements.dialForm.elements.id.value;
    if (!id || !confirm("确定删除这个网站吗？")) return;
    await deleteDial(id); elements.dialDialog.close(); await refreshData(); notifyBackground(); toast("网站已删除");
  });

  $("#top-sites-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = $$(".top-site-option:has(input:checked)", $("#top-sites-list"));
    for (const label of selected) {
      await createDial({ title: label.dataset.title, url: normalizeUrl(label.dataset.url), groupId: state.activeGroupId });
    }
    $("#top-sites-dialog").close();
    await refreshData();
    notifyBackground();
    toast(`已添加 ${selected.length} 个网站`);
  });

  elements.groupForm.addEventListener("submit", (event) => saveGroupFromForm(event).catch((error) => toast(error.message)));
  $("#delete-group").addEventListener("click", async () => {
    const id = elements.groupForm.elements.id.value;
    if (!id || id === "default" || !confirm("删除分组也会删除其中的所有网站。确定继续吗？")) return;
    await deleteGroup(id); state.activeGroupId = "default"; elements.groupDialog.close(); await refreshData(); notifyBackground(); toast("分组已删除");
  });

  $("#empty-top-sites").addEventListener("click", () => openTopSitesPicker().catch((error) => toast(error.message)));

  document.addEventListener("contextmenu", (event) => {
    if (!state.settings.showContextMenu || event.target.closest("dialog, input, textarea, select")) return;
    const card = event.target.closest(".dial-card");
    const groupTab = event.target.closest(".group-tab");
    const menu = card ? $("#dial-context-menu") : groupTab ? $("#group-context-menu") : $("#page-context-menu");
    if (!event.target.closest(".app-shell") && !card && !groupTab) return;
    event.preventDefault();
    if (groupTab) {
      const isHome = groupTab.dataset.groupId === "default";
      $("[data-command='home-note']", menu).hidden = !isHome;
      $("[data-command='delete-group']", menu).hidden = isHome;
    }
    showContextMenu(menu, event, {
      dialId: card?.dataset.dialId,
      groupId: groupTab?.dataset.groupId,
    });
  });
  document.addEventListener("click", (event) => {
    const command = event.target.closest(".context-menu [data-command]")?.dataset.command;
    if (command) runContextCommand(command).catch((error) => toast(error.message));
    else if (!event.target.closest(".context-menu")) hideContextMenus();
  });

  $("#footer-sort").addEventListener("click", async () => {
    const order = ["manual", "visits", "title"];
    state.settings.sortMode = order[(order.indexOf(state.settings.sortMode) + 1) % order.length];
    state.settings = await saveSettings({ sortMode: state.settings.sortMode });
    renderDials();
  });

  elements.settingsForm.addEventListener("submit", (event) => {
    saveSettingsForm(event).catch((error) => showSettingsStatus(`保存失败：${error.message}`, true));
  });
  elements.settingsForm.addEventListener("input", (event) => {
    const range = event.target.closest("[data-setting-range]");
    if (range) {
      elements.settingsForm.elements[range.dataset.settingRange].value = range.value;
      updateSettingsRange(range);
      return;
    }
    if (event.target.type === "number" && SETTINGS_NUMBER_FIELDS.includes(event.target.name) && event.target.value !== "") {
      const linkedRange = $(`[data-setting-range="${event.target.name}"]`, elements.settingsForm);
      if (linkedRange) updateSettingsRange(linkedRange, event.target.value);
    }
  });
  elements.settingsForm.querySelector(".settings-navigation").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-settings-tab]")?.dataset.settingsTab;
    if (tab) selectSettingsTab(tab);
  });
  $("#settings-background-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      event.target.value = "";
      showSettingsStatus("请选择小于 10 MB 的背景图片", true);
      return;
    }
    state.backgroundDraft = await fileToDataUrl(file);
    elements.settingsForm.elements.backgroundUrl.value = "";
    showSettingsStatus("已选择背景图片，保存后生效");
  });
  $("#settings-clear-background").addEventListener("click", () => {
    state.backgroundDraft = "";
    elements.settingsForm.elements.backgroundUrl.value = "";
    $("#settings-background-file").value = "";
    showSettingsStatus("背景图片已移除，保存后生效");
  });
  $("#settings-load-fonts").addEventListener("click", async (event) => {
    if (typeof window.queryLocalFonts !== "function") {
      showSettingsStatus("当前 Chrome 版本不支持读取系统字体，可以直接输入字体名称", true);
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const fonts = await window.queryLocalFonts();
      const families = [...new Set(fonts.map((font) => font.family).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "zh-CN"));
      $("#settings-font-list").replaceChildren(...families.map((family) => new Option("", family)));
      showSettingsStatus(`已读取 ${families.length} 种系统字体`);
    } catch (error) {
      showSettingsStatus(error.name === "NotAllowedError" ? "未获得字体读取权限，可以直接输入字体名称" : `读取字体失败：${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
  $("#settings-reset").addEventListener("click", () => {
    if (!confirm("确定将所有设置恢复为默认值吗？")) return;
    populateSettingsForm(DEFAULT_SETTINGS);
    showSettingsStatus("默认设置已载入，保存后生效");
  });
  $("#settings-export-backup").addEventListener("click", async () => {
    const backup = await exportBackup();
    backup.settings = state.settings;
    downloadJson(`zero-dial-${new Date().toISOString().slice(0, 10)}.json`, backup);
    showSettingsStatus("备份已导出");
  });
  $("#settings-import-backup").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!confirm("导入会替换现有的分组、网站和设置。确定继续吗？")) return;
      await importBackup(backup);
      state.settings = backup.settings ? await saveSettings(backup.settings) : await getSettings();
      applySettings(state.settings);
      populateSettingsForm();
      await refreshData({ preserveGroup: false });
      state.sidebarController?.refresh(state.settings);
      notifyBackground();
      showSettingsStatus("备份已导入");
    } catch (error) {
      showSettingsStatus(`导入失败：${error.message}`, true);
    } finally {
      event.target.value = "";
    }
  });
  $("#settings-export-bookmarks").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "export-bookmarks" });
    showSettingsStatus(response?.ok ? "已导出到 Chrome 书签" : response?.error || "导出失败", !response?.ok);
  });
  $("#settings-clear-data").addEventListener("click", async () => {
    if (!confirm("确定清空所有分组、网站、缩略图和访问统计吗？")) return;
    await clearAll();
    await refreshData({ preserveGroup: false });
    notifyBackground();
    elements.settingsDialog.close();
    toast("全部数据已清空");
  });

  elements.dialGrid.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".dial-card");
    if (!card) return;
    state.dragDialId = card.dataset.dialId; card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });
  elements.dialGrid.addEventListener("dragend", () => {
    state.dragDialId = null; $$(".dragging,.drag-over").forEach((item) => item.classList.remove("dragging", "drag-over"));
  });
  elements.dialGrid.addEventListener("dragover", (event) => {
    if (!state.dragDialId) return;
    event.preventDefault();
    $$(".dial-card.drag-over").forEach((item) => item.classList.remove("drag-over"));
    event.target.closest(".dial-card")?.classList.add("drag-over");
  });
  elements.dialGrid.addEventListener("drop", async (event) => {
    event.preventDefault();
    const target = event.target.closest(".dial-card");
    if (!target || !state.dragDialId || target.dataset.dialId === state.dragDialId) return;
    const ids = sortedVisibleDials().map((dial) => dial.id);
    const from = ids.indexOf(state.dragDialId); const to = ids.indexOf(target.dataset.dialId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await reorderDials(state.activeGroupId, ids); state.dragDialId = null; await refreshData();
  });

  elements.groupTabs.addEventListener("dragstart", (event) => {
    const tab = event.target.closest(".group-tab");
    if (tab && tab.dataset.groupId !== "default" && !state.dragDialId) { state.dragGroupId = tab.dataset.groupId; event.dataTransfer.effectAllowed = "move"; }
  });
  elements.groupTabs.addEventListener("dragover", (event) => {
    if (!state.dragDialId && !state.dragGroupId) return;
    event.preventDefault();
    $$(".group-tab.drag-over").forEach((item) => item.classList.remove("drag-over"));
    event.target.closest(".group-tab")?.classList.add("drag-over");
  });
  elements.groupTabs.addEventListener("drop", async (event) => {
    event.preventDefault();
    const target = event.target.closest(".group-tab");
    if (!target) return;
    if (state.dragDialId) {
      await moveDial(state.dragDialId, target.dataset.groupId); state.activeGroupId = target.dataset.groupId; state.dragDialId = null; await refreshData(); toast("网站已移动");
    } else if (state.dragGroupId && state.dragGroupId !== target.dataset.groupId) {
      const ids = state.groups.map((group) => group.id);
      const from = ids.indexOf(state.dragGroupId); const to = ids.indexOf(target.dataset.groupId);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await reorderGroups(ids); state.dragGroupId = null; await refreshData(); notifyBackground();
    }
  });
  elements.groupTabs.addEventListener("dragend", () => {
    state.dragGroupId = null; $$(".group-tab.drag-over").forEach((item) => item.classList.remove("drag-over"));
  });
  window.addEventListener("resize", debounce(() => renderDials(), 120));
}

async function init() {
  await bootstrap();
  state.settings = await getSettings();
  applySettings(state.settings);
  bindEvents();
  await refreshData();
  state.sidebarController = initSidebar({
    settings: state.settings,
    isSorting: () => Boolean(state.dragDialId || state.dragGroupId),
  });
  if (location.hash === "#settings") {
    openSettingsDialog();
    history.replaceState(null, "", location.pathname);
  }
}

init().catch((error) => {
  console.error(error);
  toast(`启动失败：${error.message}`);
});
