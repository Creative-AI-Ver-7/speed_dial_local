import { blobToDataUrl, currentPeriod, dataUrlToBlob, uid } from "./utils.js";

const DB_NAME = "local-speed-dial";
const DB_VERSION = 1;
const STORES = ["groups", "dials", "images"];
let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("groups")) {
        const groups = db.createObjectStore("groups", { keyPath: "id" });
        groups.createIndex("order", "order");
      }
      if (!db.objectStoreNames.contains("dials")) {
        const dials = db.createObjectStore("dials", { keyPath: "id" });
        dials.createIndex("groupId", "groupId");
        dials.createIndex("url", "url");
        dials.createIndex("order", "order");
      }
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("本地数据库升级被阻止。"));
  });
  return dbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readonly");
  return requestResult(tx.objectStore(storeName).getAll());
}

async function readOne(storeName, id) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readonly");
  return requestResult(tx.objectStore(storeName).get(id));
}

async function writeOne(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readwrite");
  await requestResult(tx.objectStore(storeName).put(value));
  return value;
}

async function deleteOne(storeName, id) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readwrite");
  await requestResult(tx.objectStore(storeName).delete(id));
}

function finishTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("本地数据库操作已中止。"));
  });
}

export async function bootstrap() {
  const groups = await readAll("groups");
  const existing = groups.find((group) => group.id === "default");
  if (existing) {
    if (existing.order !== 0) await writeOne("groups", { ...existing, order: 0, updatedAt: Date.now() });
    return { ...existing, order: 0 };
  }
  const now = Date.now();
  const home = {
    id: "default",
    name: "首页",
    color: "#ffffff",
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  // The original Home group is permanent and independent from custom groups.
  await writeOne("groups", home);
  return home;
}

export async function getGroups() {
  const groups = await readAll("groups");
  return groups.sort((a, b) => {
    if (a.id === "default") return -1;
    if (b.id === "default") return 1;
    return a.order - b.order || a.createdAt - b.createdAt;
  });
}

export async function createGroup({ name, color = "#ffffff" }) {
  const groups = await getGroups();
  const customGroups = groups.filter((group) => group.id !== "default");
  const group = {
    id: uid(),
    name: String(name || "未命名分组").trim() || "未命名分组",
    color,
    order: customGroups.length + 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return writeOne("groups", group);
}

export async function updateGroup(id, changes) {
  const group = await readOne("groups", id);
  if (!group) throw new Error("找不到该分组。");
  const next = { ...group, ...changes, id, updatedAt: Date.now() };
  if (id === "default") next.order = 0;
  return writeOne("groups", next);
}

export async function reorderGroups(ids) {
  const db = await openDatabase();
  const tx = db.transaction("groups", "readwrite");
  const store = tx.objectStore("groups");
  const groups = await requestResult(store.getAll());
  const byId = new Map(groups.map((group) => [group.id, group]));
  const home = byId.get("default");
  if (home) store.put({ ...home, order: 0, updatedAt: Date.now() });
  ids.filter((id) => id !== "default").forEach((id, index) => {
    const group = byId.get(id);
    if (group) store.put({ ...group, order: index + 1, updatedAt: Date.now() });
  });
  await finishTransaction(tx);
}

export async function deleteGroup(id) {
  if (id === "default") throw new Error("首页分组不能删除。");
  const db = await openDatabase();
  const tx = db.transaction(["groups", "dials", "images"], "readwrite");
  const dialStore = tx.objectStore("dials");
  const imageStore = tx.objectStore("images");
  const dials = await requestResult(dialStore.getAll());
  dials.filter((dial) => dial.groupId === id).forEach((dial) => {
    dialStore.delete(dial.id);
    if (dial.thumbnail?.imageId) imageStore.delete(dial.thumbnail.imageId);
  });
  tx.objectStore("groups").delete(id);
  await finishTransaction(tx);
}

export async function getDials() {
  const dials = await readAll("dials");
  return dials.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export async function getDial(id) {
  return readOne("dials", id);
}

export async function findDialByUrl(url) {
  const db = await openDatabase();
  const tx = db.transaction("dials", "readonly");
  return requestResult(tx.objectStore("dials").index("url").get(url));
}

export async function createDial({ title, url, groupId, thumbnail = { type: "default" } }) {
  const dials = await getDials();
  const order = dials.filter((dial) => dial.groupId === groupId).length;
  const dial = {
    id: uid(),
    title: String(title || "未命名网站").trim() || "未命名网站",
    url,
    groupId,
    order,
    thumbnail,
    visits: 0,
    visitsByPeriod: { morning: 0, afternoon: 0, evening: 0, night: 0 },
    lastVisitedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return writeOne("dials", dial);
}

export async function updateDial(id, changes) {
  const dial = await readOne("dials", id);
  if (!dial) throw new Error("找不到该网站。");
  const next = { ...dial, ...changes, id, updatedAt: Date.now() };
  await writeOne("dials", next);
  const oldImageId = dial.thumbnail?.imageId;
  const nextImageId = next.thumbnail?.imageId;
  if (oldImageId && oldImageId !== nextImageId) await deleteOne("images", oldImageId);
  return next;
}

export async function visitDial(id) {
  const dial = await readOne("dials", id);
  if (!dial) return;
  const period = currentPeriod();
  const visitsByPeriod = { ...dial.visitsByPeriod };
  visitsByPeriod[period] = (visitsByPeriod[period] || 0) + 1;
  await writeOne("dials", {
    ...dial,
    visits: (dial.visits || 0) + 1,
    visitsByPeriod,
    lastVisitedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function reorderDials(groupId, ids) {
  const db = await openDatabase();
  const tx = db.transaction("dials", "readwrite");
  const store = tx.objectStore("dials");
  const dials = await requestResult(store.getAll());
  const byId = new Map(dials.filter((dial) => dial.groupId === groupId).map((dial) => [dial.id, dial]));
  ids.forEach((id, order) => {
    const dial = byId.get(id);
    if (dial) store.put({ ...dial, order, updatedAt: Date.now() });
  });
  await finishTransaction(tx);
}

export async function moveDial(id, groupId, order = null) {
  const dial = await readOne("dials", id);
  if (!dial) throw new Error("找不到该网站。");
  const targetDials = (await getDials()).filter((item) => item.groupId === groupId && item.id !== id);
  const nextOrder = order == null ? targetDials.length : order;
  await writeOne("dials", { ...dial, groupId, order: nextOrder, updatedAt: Date.now() });
  await reorderDials(groupId, [...targetDials.map((item) => item.id), id]);
}

export async function deleteDial(id) {
  const dial = await readOne("dials", id);
  await deleteOne("dials", id);
  if (dial?.thumbnail?.imageId) await deleteOne("images", dial.thumbnail.imageId);
}

export async function saveImage(blob) {
  const image = { id: uid(), blob, type: blob.type, createdAt: Date.now() };
  await writeOne("images", image);
  return image.id;
}

export async function getImage(id) {
  return readOne("images", id);
}

export async function exportBackup() {
  const [groups, dials, images] = await Promise.all([
    getGroups(),
    getDials(),
    readAll("images"),
  ]);
  const serializedImages = [];
  for (const image of images) {
    serializedImages.push({
      id: image.id,
      type: image.type,
      createdAt: image.createdAt,
      dataUrl: await blobToDataUrl(image.blob),
    });
  }
  return {
    format: "local-speed-dial",
    version: 1,
    exportedAt: new Date().toISOString(),
    groups,
    dials,
    images: serializedImages,
  };
}

export async function importBackup(backup) {
  if (!backup || backup.format !== "local-speed-dial" || backup.version !== 1) {
    throw new Error("这不是受支持的快速拨号备份文件。");
  }
  if (!Array.isArray(backup.groups) || !Array.isArray(backup.dials)) {
    throw new Error("备份文件不完整。");
  }

  const restoredImages = [];
  for (const image of backup.images || []) {
    restoredImages.push({
      id: image.id,
      type: image.type,
      createdAt: image.createdAt,
      blob: await dataUrlToBlob(image.dataUrl),
    });
  }

  const db = await openDatabase();
  const tx = db.transaction(STORES, "readwrite");
  for (const storeName of STORES) tx.objectStore(storeName).clear();
  backup.groups.forEach((group) => tx.objectStore("groups").put(group));
  backup.dials.forEach((dial) => tx.objectStore("dials").put(dial));
  restoredImages.forEach((image) => tx.objectStore("images").put(image));
  await finishTransaction(tx);
  await bootstrap();
}

export async function clearAll() {
  const db = await openDatabase();
  const tx = db.transaction(STORES, "readwrite");
  STORES.forEach((storeName) => tx.objectStore(storeName).clear());
  await finishTransaction(tx);
  return bootstrap();
}
