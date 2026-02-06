/**
 * Optimized PersistentStorage using Inline Web Worker
 * "Cơ chế XL" (Processing Mechanism): Offloads heavy DB operations to a background thread
 * to prevent UI freezing during large data syncs.
 */

// Worker code as a string to avoid bundler configuration issues
const WORKER_CODE = `
const dbName = '360data_bi_cache';
const storeName = 'data_sources';
const version = 1;
let db = null;

const getDB = () => {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);
        const request = indexedDB.open(dbName, version);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(storeName)) {
                database.createObjectStore(storeName);
            }
        };
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onerror = () => reject(request.error);
    });
};

self.onmessage = async (e) => {
    const { id, type, key, value } = e.data;
    try {
        const database = await getDB();
        
        if (type === 'set') {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            // Put request
            const req = store.put(value, key);
            req.onsuccess = () => self.postMessage({ id, status: 'success' });
            req.onerror = () => self.postMessage({ id, status: 'error', error: req.error });
        } 
        else if (type === 'get') {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => self.postMessage({ id, status: 'success', data: req.result });
            req.onerror = () => self.postMessage({ id, status: 'error', error: req.error });
        }
        else if (type === 'delete') {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => self.postMessage({ id, status: 'success' });
            req.onerror = () => self.postMessage({ id, status: 'error', error: req.error });
        }
    } catch (err) {
        self.postMessage({ id, status: 'error', error: err ? err.message : 'Unknown error' });
    }
};
`;

export class PersistentStorage {
    private static worker: Worker | null = null;
    private static pendingRequests = new Map<string, { resolve: Function, reject: Function }>();

    private static initWorker() {
        if (typeof window === 'undefined') return;
        if (!this.worker) {
            const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob));

            this.worker.onmessage = (e) => {
                const { id, status, data, error } = e.data;
                const request = this.pendingRequests.get(id);
                if (request) {
                    if (status === 'success') {
                        request.resolve(data);
                    } else {
                        request.reject(error);
                    }
                    this.pendingRequests.delete(id);
                }
            };
        }
    }

    private static runWorkerCmd(type: 'set' | 'get' | 'delete', key: string, value?: any): Promise<any> {
        this.initWorker();
        if (!this.worker) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const id = Math.random().toString(36).substring(7);
            this.pendingRequests.set(id, { resolve, reject });
            this.worker!.postMessage({ id, type, key, value });
        });
    }

    static async set(key: string, value: any): Promise<void> {
        return this.runWorkerCmd('set', key, value);
    }

    static async get(key: string): Promise<any> {
        return this.runWorkerCmd('get', key);
    }

    static async delete(key: string): Promise<void> {
        return this.runWorkerCmd('delete', key);
    }
}
