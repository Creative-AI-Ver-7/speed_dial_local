import { bootstrap, createDial, createGroup, getGroups, saveImage, updateDial } from "./db.js";
import { dataUrlToBlob, hostname, normalizeUrl } from "./utils.js";

const groupList = document.querySelector("#group-list");
const createForm = document.querySelector("#create-group-form");
const status = document.querySelector("#status");
let activeTab;
let saving = false;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#b42318" : "#555";
}

async function saveToGroup(groupId) {
  if (saving) return;
  saving = true;
  document.querySelector("#popup-heading").textContent = "正在保存…";
  groupList.hidden = true;
  document.querySelector(".create-list").hidden = true;
  createForm.hidden = true;
  try {
    const dial = await createDial({
      title: activeTab.title || hostname(activeTab.url),
      url: normalizeUrl(activeTab.url),
      groupId,
      thumbnail: { type: "default" },
    });
    try {
      const response = await chrome.runtime.sendMessage({ type: "capture-current", windowId: activeTab.windowId });
      if (response?.ok) {
        const imageId = await saveImage(await dataUrlToBlob(response.dataUrl));
        await updateDial(dial.id, { thumbnail: { type: "screenshot", imageId } });
      }
    } catch {
      // The dial is still valid if a protected page cannot be captured.
    }
    await chrome.runtime.sendMessage({ type: "refresh-context-menus" });
    document.querySelector("#popup-heading").textContent = "页面已保存";
    setTimeout(() => window.close(), 700);
  } catch (error) {
    saving = false;
    groupList.hidden = false;
    document.querySelector(".create-list").hidden = false;
    document.querySelector("#popup-heading").textContent = "保存页面到";
    setStatus(error.message, true);
  }
}

async function renderGroups() {
  const groups = await getGroups();
  groupList.replaceChildren();
  for (const group of groups) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = group.name;
    button.addEventListener("click", () => saveToGroup(group.id));
    item.append(button);
    groupList.append(item);
  }
}

async function init() {
  await bootstrap();
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url || !/^https?:\/\//i.test(activeTab.url)) {
    groupList.hidden = true;
    document.querySelector(".create-list").hidden = true;
    throw new Error("当前页面无法添加。");
  }
  await renderGroups();
}

document.querySelector("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#show-create-group").addEventListener("click", () => {
  createForm.hidden = false;
  createForm.elements.name.focus();
});
createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const group = await createGroup({ name: createForm.elements.name.value.trim() });
    await chrome.runtime.sendMessage({ type: "refresh-context-menus" });
    await saveToGroup(group.id);
  } catch (error) {
    setStatus(error.message, true);
  }
});

init().catch((error) => setStatus(error.message, true));
