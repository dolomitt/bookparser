const DB_NAME = 'bookparser-offline-cache';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const FALLBACK_PREFIX = 'bookparser-offline:';

let dbPromise = null;

const openDb = () => {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB is not available'));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
};

const withStore = async (mode, callback) => {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const fallbackKey = (key) => `${FALLBACK_PREFIX}${key}`;

export const setCachedEntry = async (key, value) => {
  const entry = {
    key,
    value,
    updatedAt: new Date().toISOString()
  };

  try {
    await withStore('readwrite', (store) => store.put(entry));
  } catch (error) {
    window.localStorage.setItem(fallbackKey(key), JSON.stringify(entry));
  }

  return entry;
};

export const getCachedEntry = async (key) => {
  try {
    const entry = await withStore('readonly', (store) => store.get(key));
    return entry?.value || null;
  } catch (error) {
    const raw = window.localStorage.getItem(fallbackKey(key));
    if (!raw) return null;

    try {
      return JSON.parse(raw).value || null;
    } catch (parseError) {
      return null;
    }
  }
};

export const listCachedEntries = async (prefix) => {
  try {
    const db = await openDb();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      const entries = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(entries);
          return;
        }

        if (String(cursor.value.key).startsWith(prefix)) {
          entries.push(cursor.value);
        }
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    return Object.keys(window.localStorage)
      .filter((key) => key.startsWith(fallbackKey(prefix)))
      .map((key) => {
        try {
          return JSON.parse(window.localStorage.getItem(key));
        } catch (parseError) {
          return null;
        }
      })
      .filter(Boolean);
  }
};

export const cacheBookText = (book, text) => setCachedEntry(`book:${book}`, { book, text });

export const getCachedBookText = async (book) => {
  const cached = await getCachedEntry(`book:${book}`);
  return cached?.text || null;
};

export const cacheImportPayload = (filename, payload) => (
  setCachedEntry(`import:${filename}`, { filename, payload })
);

export const getCachedImportPayload = async (filename) => {
  const cached = await getCachedEntry(`import:${filename}`);
  return cached?.payload || null;
};

export const updateCachedImportSentence = async (filename, sentenceIndex, sentenceData, verbMergeOptions = {}) => {
  const payload = await getCachedImportPayload(filename);
  if (!payload) return null;

  const nextPayload = {
    ...payload,
    existingProcessedSentences: {
      ...(payload.existingProcessedSentences || {}),
      [sentenceIndex]: sentenceData
    },
    existingVerbMergeOptions: {
      ...(payload.existingVerbMergeOptions || {}),
      ...verbMergeOptions
    }
  };

  await cacheImportPayload(filename, nextPayload);
  return nextPayload;
};

export const cacheResourceList = (kind, items) => setCachedEntry(`list:${kind}`, items);

export const getCachedResourceList = async (kind) => getCachedEntry(`list:${kind}`);

export const getCachedImportItems = async () => {
  const entries = await listCachedEntries('import:');
  return entries.map(({ value }) => {
    const payload = value?.payload || {};
    const filename = value?.filename;
    return {
      filename,
      displayTitle: payload.existingSummaryTitle || filename,
      summaryTitle: payload.existingSummaryTitle || null,
      wordCount: null,
      difficultyLevel: null,
      offlineOnly: true
    };
  }).filter((item) => item.filename);
};

export const getCachedBookItems = async () => {
  const entries = await listCachedEntries('book:');
  return entries.map(({ value }) => ({
    filename: value?.book,
    displayTitle: value?.book,
    summaryTitle: null,
    wordCount: null,
    difficultyLevel: null,
    offlineOnly: true
  })).filter((item) => item.filename);
};
