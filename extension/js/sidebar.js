import { faviconUrl, formatRelativeTime, hostname } from "./utils.js";

const $ = (selector, root = document) => root.querySelector(selector);

function makeLinkRow({ title, url, subtitle = "", className = "" }) {
  const item = document.createElement("li");
  item.className = className;
  const link = document.createElement("a");
  link.href = url;
  link.title = title || url;
  if (url) link.style.backgroundImage = `url(${JSON.stringify(faviconUrl(url, 32))})`;
  const strong = document.createElement("b");
  strong.textContent = title || hostname(url) || "无标题";
  link.append(strong);
  if (subtitle) {
    link.append(document.createElement("br"), document.createTextNode(subtitle));
  }
  item.append(link);
  return item;
}

export function initSidebar({ settings, isSorting = () => false }) {
  const shell = $("#sidebars");
  const trigger = $("#sidebar-toggle");
  const workspace = $(".app-shell");
  const bookmarkPanel = $("#bookmarks-sidebar");
  const historyPanel = $("#history-sidebar");
  const bookmarkList = $("#bookmarks-list");
  const bookmarkSearch = $("#bookmarks-search");
  const historyList = $("#history-items");
  const historySearch = $("#history-search");
  if (!shell || !trigger || !workspace) return { refresh() {} };

  const panelWidth = Number.parseFloat(getComputedStyle(shell).getPropertyValue("--sidebar-panel-width")) || 340;
  let currentSettings = settings;
  let bookmarkFolderId = "1";
  let bookmarkRequestId = 0;
  let historyRequestId = 0;
  let panelCount = 0;
  let width = 0;
  let isOpen = false;

  function configure(nextSettings = currentSettings) {
    currentSettings = nextSettings;
    bookmarkPanel.hidden = !(currentSettings.sidebarEnabled && currentSettings.sidebarBookmarks);
    historyPanel.hidden = !(currentSettings.sidebarEnabled && currentSettings.sidebarHistory);
    panelCount = [bookmarkPanel, historyPanel].filter((panel) => !panel.hidden).length;
    width = panelCount * panelWidth;
    isOpen = false;
    shell.style.width = `${width}px`;
    shell.style.right = `${panelCount ? 1 - width : 0}px`;
    trigger.hidden = panelCount === 0;
    $(".sidebar-arrow")?.toggleAttribute("hidden", panelCount === 0);
  }

  async function loadBookmarks(folderId = bookmarkFolderId) {
    const requestId = ++bookmarkRequestId;
    const nextFolderId = folderId || "1";
    const content = document.createDocumentFragment();
    try {
      const [folder] = await chrome.bookmarks.get(nextFolderId);
      if (folder?.parentId) {
        const back = document.createElement("li");
        back.className = "bookmark-folder bookmark-back";
        back.dataset.folderId = folder.parentId;
        const link = document.createElement("button");
        link.type = "button";
        link.textContent = "返回";
        back.append(link);
        content.append(back);
      }
      const children = await chrome.bookmarks.getChildren(nextFolderId);
      for (const node of children) {
        if (node.url) {
          content.append(makeLinkRow({ title: node.title, url: node.url, className: "bookmark-link" }));
        } else {
          const item = document.createElement("li");
          item.className = "bookmark-folder";
          item.dataset.folderId = node.id;
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = node.title || "未命名文件夹";
          item.append(button);
          content.append(item);
        }
      }
      if (requestId !== bookmarkRequestId) return;
      bookmarkFolderId = nextFolderId;
      bookmarkList.replaceChildren(content);
    } catch (error) {
      if (requestId !== bookmarkRequestId) return;
      const item = document.createElement("li");
      item.className = "sidebar-note";
      item.textContent = error.message;
      bookmarkList.replaceChildren(item);
    }
  }

  async function searchBookmarks(query) {
    const requestId = ++bookmarkRequestId;
    const content = document.createDocumentFragment();
    const back = document.createElement("li");
    back.className = "bookmark-folder bookmark-back";
    back.dataset.folderId = "1";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "返回";
    back.append(button);
    content.append(back);
    const results = await chrome.bookmarks.search(query);
    if (requestId !== bookmarkRequestId) return;
    results.filter((node) => node.url).forEach((node) => {
      content.append(makeLinkRow({ title: node.title, url: node.url, className: "bookmark-link" }));
    });
    bookmarkList.replaceChildren(content);
  }

  function sessionDetails(session) {
    const extensionNewTabUrl = chrome.runtime.getURL("newtab.html");
    const tabs = session.tab ? [session.tab] : session.window?.tabs || [];
    const tab = tabs.find((item) => item.url !== "chrome://newtab/" && item.url !== extensionNewTabUrl);
    if (!tab) return null;
    return {
      sessionId: session.tab?.sessionId || session.window?.sessionId,
      title: tab.title || "已关闭的窗口",
      url: tab.url || "",
    };
  }

  async function getRecentlyClosedState() {
    const stored = await chrome.storage.local.get("dismissedSessionIds");
    const recent = (await chrome.sessions.getRecentlyClosed({ maxResults: 25 }))
      .map(sessionDetails)
      .filter((item) => item?.sessionId);
    const recentIds = new Set(recent.map((item) => item.sessionId));
    const dismissedSessionIds = (stored.dismissedSessionIds || []).filter((id) => recentIds.has(id));
    if (dismissedSessionIds.length !== (stored.dismissedSessionIds || []).length) {
      await chrome.storage.local.set({ dismissedSessionIds });
    }
    const dismissed = new Set(dismissedSessionIds);
    return { dismissedSessionIds, sessions: recent.filter((item) => !dismissed.has(item.sessionId)) };
  }

  async function loadRecentlyClosed() {
    const requestId = ++historyRequestId;
    const content = document.createDocumentFragment();
    const { sessions } = await getRecentlyClosedState();
    if (requestId !== historyRequestId) return;

    if (sessions.length > 1) {
      const restoreAll = document.createElement("li");
      restoreAll.className = "session-command restore-all";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `恢复 ${sessions.length} 个标签页`;
      restoreAll.append(button);
      content.append(restoreAll);
    }

    for (const session of sessions) {
      const item = makeLinkRow({ title: session.title, url: session.url, className: "recent-session" });
      item.dataset.sessionId = session.sessionId;
      item.querySelector("a").addEventListener("click", async (event) => {
        event.preventDefault();
        await chrome.sessions.restore(session.sessionId);
        await loadRecentlyClosed();
      });
      content.append(item);
    }

    if (!sessions.length) {
      const empty = document.createElement("li");
      empty.className = "sidebar-note";
      empty.textContent = "没有最近关闭的标签页";
      content.append(empty);
    } else {
      const clear = document.createElement("li");
      clear.className = "session-command clear-sessions";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "清除列表";
      clear.append(button);
      content.append(clear);
    }
    historyList.replaceChildren(content);
  }

  async function searchHistory(query) {
    const requestId = ++historyRequestId;
    const content = document.createDocumentFragment();
    const results = await chrome.history.search({ text: query, maxResults: 25 });
    if (requestId !== historyRequestId) return;
    results.forEach((entry) => {
      content.append(makeLinkRow({
        title: entry.title,
        url: entry.url,
        subtitle: formatRelativeTime(entry.lastVisitTime),
        className: "history-link",
      }));
    });
    historyList.replaceChildren(content);
  }

  function open() {
    if (!panelCount || isSorting() || isOpen) return;
    isOpen = true;
    shell.style.right = "0px";
    if (!bookmarkPanel.hidden && !bookmarkList.children.length) loadBookmarks().catch(console.error);
    if (!historyPanel.hidden) loadRecentlyClosed().catch(console.error);
  }

  function close() {
    if (!panelCount) return;
    isOpen = false;
    shell.style.right = `${1 - width}px`;
  }

  trigger.addEventListener("mouseenter", open);
  shell.addEventListener("mouseenter", open);
  workspace.addEventListener("mouseenter", (event) => {
    if (!shell.contains(event.target) && event.target !== trigger) close();
  });

  bookmarkList.addEventListener("click", (event) => {
    const folder = event.target.closest("[data-folder-id]");
    if (folder) loadBookmarks(folder.dataset.folderId).catch(console.error);
  });
  bookmarkSearch.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      bookmarkSearch.value = "";
      loadBookmarks("1").catch(console.error);
      return;
    }
    const query = bookmarkSearch.value.trim();
    if (query.length >= 3) searchBookmarks(query).catch(console.error);
    else loadBookmarks(bookmarkFolderId).catch(console.error);
  });

  historySearch.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      historySearch.value = "";
      loadRecentlyClosed().catch(console.error);
      return;
    }
    const query = historySearch.value.trim();
    if (query.length >= 3) searchHistory(query).catch(console.error);
    else loadRecentlyClosed().catch(console.error);
  });

  historyList.addEventListener("click", async (event) => {
    if (event.target.closest(".restore-all")) {
      const { sessions } = await getRecentlyClosedState();
      for (const session of sessions) {
        await chrome.sessions.restore(session.sessionId).catch(() => {});
      }
      await loadRecentlyClosed();
    }
    if (event.target.closest(".clear-sessions")) {
      const { dismissedSessionIds, sessions } = await getRecentlyClosedState();
      await chrome.storage.local.set({
        dismissedSessionIds: [...new Set([...dismissedSessionIds, ...sessions.map((item) => item.sessionId)])],
      });
      await loadRecentlyClosed();
    }
  });

  configure(settings);
  // Commit the collapsed position before enabling transitions so page startup
  // never animates the sidebar from its default right: 0 position.
  shell.getBoundingClientRect();
  shell.classList.add("sidebar-ready");
  return {
    refresh(nextSettings = currentSettings) {
      configure(nextSettings);
      if (!bookmarkPanel.hidden) loadBookmarks(bookmarkFolderId).catch(console.error);
      if (!historyPanel.hidden) loadRecentlyClosed().catch(console.error);
    },
  };
}
