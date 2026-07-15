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

  let currentSettings = settings;
  let bookmarkFolderId = "1";
  let panelCount = 0;
  let width = 0;

  function configure(nextSettings = currentSettings) {
    currentSettings = nextSettings;
    bookmarkPanel.hidden = !(currentSettings.sidebarEnabled && currentSettings.sidebarBookmarks);
    historyPanel.hidden = !(currentSettings.sidebarEnabled && currentSettings.sidebarHistory);
    panelCount = [bookmarkPanel, historyPanel].filter((panel) => !panel.hidden).length;
    width = panelCount * 281;
    shell.style.width = `${width}px`;
    shell.style.right = `${panelCount ? 1 - width : 0}px`;
    trigger.hidden = panelCount === 0;
    $(".sidebar-arrow")?.toggleAttribute("hidden", panelCount === 0);
  }

  async function loadBookmarks(folderId = bookmarkFolderId) {
    bookmarkFolderId = folderId || "1";
    bookmarkList.replaceChildren();
    try {
      const [folder] = await chrome.bookmarks.get(bookmarkFolderId);
      if (folder?.parentId) {
        const back = document.createElement("li");
        back.className = "bookmark-folder bookmark-back";
        back.dataset.folderId = folder.parentId;
        const link = document.createElement("button");
        link.type = "button";
        link.textContent = "返回";
        back.append(link);
        bookmarkList.append(back);
      }
      const children = await chrome.bookmarks.getChildren(bookmarkFolderId);
      for (const node of children) {
        if (node.url) {
          bookmarkList.append(makeLinkRow({ title: node.title, url: node.url, className: "bookmark-link" }));
        } else {
          const item = document.createElement("li");
          item.className = "bookmark-folder";
          item.dataset.folderId = node.id;
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = node.title || "未命名文件夹";
          item.append(button);
          bookmarkList.append(item);
        }
      }
    } catch (error) {
      const item = document.createElement("li");
      item.className = "sidebar-note";
      item.textContent = error.message;
      bookmarkList.append(item);
    }
  }

  async function searchBookmarks(query) {
    bookmarkList.replaceChildren();
    const back = document.createElement("li");
    back.className = "bookmark-folder bookmark-back";
    back.dataset.folderId = "1";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "返回";
    back.append(button);
    bookmarkList.append(back);
    const results = await chrome.bookmarks.search(query);
    results.filter((node) => node.url).forEach((node) => {
      bookmarkList.append(makeLinkRow({ title: node.title, url: node.url, className: "bookmark-link" }));
    });
  }

  function sessionDetails(session) {
    const tab = session.tab || session.window?.tabs?.[0];
    return {
      sessionId: session.tab?.sessionId || session.window?.sessionId,
      title: tab?.title || "已关闭的窗口",
      url: tab?.url || "",
    };
  }

  async function loadRecentlyClosed() {
    historyList.replaceChildren();
    const { dismissedSessionIds = [] } = await chrome.storage.local.get("dismissedSessionIds");
    const dismissed = new Set(dismissedSessionIds);
    const sessions = (await chrome.sessions.getRecentlyClosed({ maxResults: 25 }))
      .map(sessionDetails)
      .filter((item) => item.sessionId && !dismissed.has(item.sessionId));

    if (sessions.length > 1) {
      const restoreAll = document.createElement("li");
      restoreAll.className = "session-command restore-all";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `恢复 ${sessions.length} 个标签页`;
      restoreAll.append(button);
      historyList.append(restoreAll);
    }

    for (const session of sessions) {
      const item = makeLinkRow({ title: session.title, url: session.url, className: "recent-session" });
      item.dataset.sessionId = session.sessionId;
      item.querySelector("a").addEventListener("click", async (event) => {
        event.preventDefault();
        await chrome.sessions.restore(session.sessionId);
      });
      historyList.append(item);
    }

    if (!sessions.length) {
      const empty = document.createElement("li");
      empty.className = "sidebar-note";
      empty.textContent = "没有最近关闭的标签页";
      historyList.append(empty);
    } else {
      const clear = document.createElement("li");
      clear.className = "session-command clear-sessions";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "清除列表";
      clear.append(button);
      historyList.append(clear);
    }
  }

  async function searchHistory(query) {
    historyList.replaceChildren();
    const results = await chrome.history.search({ text: query, maxResults: 25 });
    results.forEach((entry) => {
      historyList.append(makeLinkRow({
        title: entry.title,
        url: entry.url,
        subtitle: formatRelativeTime(entry.lastVisitTime),
        className: "history-link",
      }));
    });
  }

  function open() {
    if (!panelCount || isSorting()) return;
    shell.style.right = "0px";
    if (!bookmarkPanel.hidden && !bookmarkList.children.length) loadBookmarks().catch(console.error);
    if (!historyPanel.hidden) loadRecentlyClosed().catch(console.error);
  }

  function close() {
    if (!panelCount) return;
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
    else if (!query) loadBookmarks(bookmarkFolderId).catch(console.error);
  });

  historySearch.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      historySearch.value = "";
      loadRecentlyClosed().catch(console.error);
      return;
    }
    const query = historySearch.value.trim();
    if (query.length >= 3) searchHistory(query).catch(console.error);
    else if (!query) loadRecentlyClosed().catch(console.error);
  });

  historyList.addEventListener("click", async (event) => {
    if (event.target.closest(".restore-all")) {
      const sessions = (await chrome.sessions.getRecentlyClosed({ maxResults: 25 })).map(sessionDetails);
      for (const session of sessions) {
        if (session.sessionId) await chrome.sessions.restore(session.sessionId).catch(() => {});
      }
    }
    if (event.target.closest(".clear-sessions")) {
      const sessions = (await chrome.sessions.getRecentlyClosed({ maxResults: 25 })).map(sessionDetails);
      await chrome.storage.local.set({ dismissedSessionIds: sessions.map((item) => item.sessionId).filter(Boolean) });
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
