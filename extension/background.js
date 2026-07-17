import {
  bootstrap,
  createDial,
  getDials,
  getGroups,
  saveImage,
  updateDial,
} from "./js/db.js";
import { dataUrlToBlob, hostname, normalizeUrl } from "./js/utils.js";

const MENU = {
  ADD_CURRENT: "local-speed-dial:add-current",
  ADD_ALL: "local-speed-dial:add-all",
  GROUP_PARENT: "local-speed-dial:groups",
  GROUP_PREFIX: "local-speed-dial:group:",
};

function isSupportedUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

let menuRefresh = Promise.resolve();

function createMenu(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function refreshContextMenus() {
  // Installation, worker startup and UI messages can arrive together. Serializing
  // rebuilds prevents duplicate-id errors while keeping menu labels fresh.
  menuRefresh = menuRefresh.then(async () => {
    const groups = await getGroups();
    await chrome.contextMenus.removeAll();
    await createMenu({
      id: MENU.ADD_CURRENT,
      title: "添加当前网页到快速拨号",
      contexts: ["page", "action"],
    });
    await createMenu({
      id: MENU.GROUP_PARENT,
      title: "添加当前网页到分组",
      contexts: ["page", "action"],
    });
    for (const group of groups) {
      await createMenu({
        id: `${MENU.GROUP_PREFIX}${group.id}`,
        parentId: MENU.GROUP_PARENT,
        title: group.name,
        contexts: ["page", "action"],
      });
    }
    await createMenu({
      id: MENU.ADD_ALL,
      title: "添加所有已打开网页",
      contexts: ["action"],
    });
  }, async () => {
    await chrome.contextMenus.removeAll();
  });
  return menuRefresh;
}

async function addUrlToGroup({ url, title, groupId }) {
  const normalized = normalizeUrl(url);
  const dial = await createDial({
    title: title || hostname(normalized),
    url: normalized,
    groupId,
  });
  return { dial, created: true };
}

async function defaultGroupId() {
  await bootstrap();
  return (await getGroups())[0].id;
}

async function captureCurrentDial(dialId, windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 90 });
    const imageId = await saveImage(await dataUrlToBlob(dataUrl));
    await updateDial(dialId, { thumbnail: { type: "screenshot", imageId } });
  } catch {
    // Protected Chrome pages and restricted documents keep the favicon fallback.
  }
}

async function showActionResult(text) {
  await chrome.action.setBadgeBackgroundColor({ color: "#4285f4" });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), 1200);
}

function waitForTabComplete(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
    };
    const finish = (error, tab) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(tab);
    };
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(null, tab);
    };
    const timer = setTimeout(() => finish(new Error("网页加载超时，未能生成截图。")), timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish(null, tab);
    }).catch((error) => finish(error));
  });
}

async function captureDialAutomatically({ dialId, url, sourceTabId, windowId, quality = "high" }) {
  if (!isSupportedUrl(url)) throw new Error("该网址无法生成网页截图。");
  const permitted = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  if (!permitted) throw new Error("未授予网页截图权限。");

  let targetTab;
  try {
    targetTab = await chrome.tabs.create({ url, active: true, windowId });
    await waitForTabComplete(targetTab.id);
    // Give client-rendered pages a short moment after the load event to paint.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await chrome.windows.update(targetTab.windowId, { focused: true });
    await chrome.tabs.update(targetTab.id, { active: true });
    const jpegQuality = quality === "low" ? 60 : quality === "medium" ? 75 : 90;
    const dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, {
      format: "jpeg",
      quality: jpegQuality,
    });
    const imageId = await saveImage(await dataUrlToBlob(dataUrl));
    await updateDial(dialId, { thumbnail: { type: "screenshot", imageId } });
    return { ok: true, imageId };
  } finally {
    if (targetTab?.id != null) await chrome.tabs.remove(targetTab.id).catch(() => {});
    if (Number.isInteger(sourceTabId)) await chrome.tabs.update(sourceTabId, { active: true }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => {
  bootstrap().then(refreshContextMenus).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap().then(refreshContextMenus).catch(console.error);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    if (info.menuItemId === MENU.ADD_ALL) {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const groupId = await defaultGroupId();
      let count = 0;
      for (const item of tabs.filter((candidate) => isSupportedUrl(candidate.url))) {
        const result = await addUrlToGroup({ url: item.url, title: item.title, groupId });
        if (result.created) count += 1;
      }
      await showActionResult(String(count));
      return;
    }

    const url = info.pageUrl || tab?.url;
    if (!isSupportedUrl(url)) return;
    const groupId = String(info.menuItemId).startsWith(MENU.GROUP_PREFIX)
      ? String(info.menuItemId).slice(MENU.GROUP_PREFIX.length)
      : await defaultGroupId();
    const result = await addUrlToGroup({ url, title: tab?.title, groupId });
    if (tab?.windowId != null) await captureCurrentDial(result.dial.id, tab.windowId);
    await showActionResult(result.created ? "✓" : "•");
  })().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "refresh-context-menus") {
      await refreshContextMenus();
      return { ok: true };
    }
    if (message?.type === "capture-current") {
      const options = { format: "jpeg", quality: 82 };
      const windowId = Number.isInteger(message.windowId) ? message.windowId : sender.tab?.windowId;
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, options);
      return { ok: true, dataUrl };
    }
    if (message?.type === "capture-dial-automatically") {
      return captureDialAutomatically({
        dialId: message.dialId,
        url: message.url,
        sourceTabId: message.sourceTabId,
        windowId: message.windowId,
        quality: message.quality,
      });
    }
    if (message?.type === "export-bookmarks") {
      const groups = await getGroups();
      const dials = await getDials();
      const root = await chrome.bookmarks.create({ title: `Zero Dial — ${new Date().toLocaleDateString()}` });
      for (const group of groups) {
        const folder = await chrome.bookmarks.create({ parentId: root.id, title: group.name });
        for (const dial of dials.filter((item) => item.groupId === group.id)) {
          await chrome.bookmarks.create({ parentId: folder.id, title: dial.title, url: dial.url });
        }
      }
      return { ok: true, folderId: root.id };
    }
    return { ok: false, error: "未知操作。" };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

bootstrap().then(refreshContextMenus).catch(console.error);
