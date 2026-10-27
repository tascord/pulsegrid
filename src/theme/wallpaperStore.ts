/**
 * IndexedDB backing for the editor wallpaper.
 *
 * Wallpaper data URLs (especially animated GIFs) can be many megabytes,
 * far beyond the ~5 MB localStorage quota. The theme settings JSON stays in
 * localStorage; the image itself lives here as a data-URL string.
 */

const DB_NAME = 'pulsegrid';
const STORE = 'wallpaper';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('idb-unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb-open'));
  });
}

export async function loadWallpaper(): Promise<string | null> {
  try {
    const db = await openDb();
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const get = tx.objectStore(STORE).get(KEY);
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => reject(get.error ?? new Error('idb-read'));
      });
      return typeof value === 'string' && value.startsWith('data:image/') ? value : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function saveWallpaper(dataUrl: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('idb-write'));
      tx.objectStore(STORE).put(dataUrl, KEY);
    });
  } finally {
    db.close();
  }
}

export async function clearWallpaper(): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('idb-delete'));
        tx.objectStore(STORE).delete(KEY);
      });
    } finally {
      db.close();
    }
  } catch {
    // IndexedDB unavailable — nothing to clear.
  }
}
