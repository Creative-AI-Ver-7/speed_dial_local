import { getDials } from "./db.js";
import { hostname } from "./utils.js";

const TITLES = {
  overall: "最常访问的网站",
  morning: "早晨最常访问的网站",
  afternoon: "下午最常访问的网站",
  evening: "晚上最常访问的网站",
  night: "深夜最常访问的网站",
  history: "浏览历史中最常访问的网站",
};

let dials = [];
let historyItems = null;

function renderRows(items) {
  const list = document.querySelector("#stat-list");
  list.replaceChildren();
  if (!items.length || !items.some((item) => item.value > 0)) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无统计数据";
    list.append(empty);
    return;
  }
  const max = Math.max(1, ...items.map((item) => item.value));
  items.slice(0, 20).forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "stat-row";
    const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span"); name.className = "stat-name"; name.textContent = item.title;
    const bar = document.createElement("span"); bar.className = "bar";
    const fill = document.createElement("i"); fill.style.width = `${item.value / max * 100}%`; bar.append(fill);
    const value = document.createElement("span"); value.className = "value"; value.textContent = String(item.value);
    row.append(rank, name, bar, value);
    list.append(row);
  });
}

async function showView(view) {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelector("#stat-title").textContent = TITLES[view];
  if (view === "history") {
    if (!historyItems) {
      const entries = await chrome.history.search({ text: "", startTime: 0, maxResults: 5000 });
      historyItems = entries.map((entry) => ({
        title: entry.title || hostname(entry.url),
        value: entry.visitCount || 0,
      })).sort((a, b) => b.value - a.value);
    }
    renderRows(historyItems);
    return;
  }
  const items = dials.map((dial) => ({
    title: dial.title,
    value: view === "overall" ? dial.visits || 0 : dial.visitsByPeriod?.[view] || 0,
  })).sort((a, b) => b.value - a.value);
  renderRows(items);
}

document.querySelector("#stat-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) showView(button.dataset.view).catch(console.error);
});

getDials().then((items) => {
  dials = items;
  return showView("overall");
}).catch(console.error);
