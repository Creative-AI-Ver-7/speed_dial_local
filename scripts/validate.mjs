import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("../extension/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const errors = [];
const requiredFiles = ["newtab.html", "options.html", "statistics.html", "popup.html", "js/sidebar.js"];
for (const file of requiredFiles) {
  try { await readFile(new URL(file, root)); }
  catch { errors.push(`required entry point is missing: ${file}`); }
}

if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
if (!manifest.background?.service_worker) errors.push("service worker is missing");
if (!manifest.chrome_url_overrides?.newtab) errors.push("new-tab override is missing");
const unexpectedHosts = (manifest.host_permissions || []).filter((pattern) => pattern !== "<all_urls>");
if (unexpectedHosts.length) errors.push(`unexpected host permissions: ${unexpectedHosts.join(", ")}`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    files.push(...(entry.isDirectory() ? await walk(path) : [path]));
  }
  return files;
}

for (const path of await walk(new URL(".", root).pathname)) {
  if (![".html", ".js"].includes(extname(path))) continue;
  const source = await readFile(path, "utf8");
  if (/<script\b[^>]*\bsrc=["']https?:/i.test(source)) errors.push(`${path}: remote script`);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) errors.push(`${path}: runtime code generation`);
  if (/speeddial2|speedial2|braintree|google-analytics/i.test(source)) errors.push(`${path}: legacy service reference`);
  if (/所有数据仅保存在本机|Chrome 本机数据|仅统计本机数据|Speed Dial 2 本地版|纯本地/.test(source)) {
    errors.push(`${path}: non-original local-only product copy`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Zero Dial ${manifest.version}: manifest, entry points and code policy OK`);
