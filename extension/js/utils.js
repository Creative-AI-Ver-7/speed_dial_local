const PERIOD_LABELS = {
  morning: "上午",
  afternoon: "下午",
  evening: "晚上",
  night: "深夜",
};

export { PERIOD_LABELS };

export function uid() {
  return crypto.randomUUID();
}

export function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("请输入网址。");

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)
    ? raw
    : `https://${raw}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("只能添加 http 或 https 网址。");
  }
  url.hash = "";
  return url.href;
}

export function hostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

export function initials(value) {
  const host = hostname(value);
  const chunks = host.split(/[.-]/).filter(Boolean);
  if (!chunks.length) return "·";
  if (chunks.length === 1) return chunks[0].slice(0, 2).toUpperCase();
  return `${chunks[0][0]}${chunks[1][0]}`.toUpperCase();
}

export function hueFor(value) {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export function faviconUrl(pageUrl, size = 64) {
  const base = chrome.runtime.getURL("/_favicon/");
  return `${base}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

export function currentPeriod(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18) return "evening";
  return "night";
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return "从未";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(timestamp).toLocaleDateString();
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("无法读取文件。"));
    reader.readAsDataURL(file);
  });
}

export async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("无法读取图片。"));
    reader.readAsDataURL(blob);
  });
}

export async function requestPermission(permission) {
  const descriptor = { permissions: [permission] };
  if (await chrome.permissions.contains(descriptor)) return true;
  return chrome.permissions.request(descriptor);
}

export function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function debounce(fn, delay = 160) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

export function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}
