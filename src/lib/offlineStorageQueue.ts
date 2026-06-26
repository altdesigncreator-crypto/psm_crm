/**
 * Offline Storage Queue — IndexedDB-backed file upload fallback.
 *
 * When Firebase Storage upload fails due to network loss, this module
 * stores the raw Blob together with metadata in IndexedDB.
 * When connectivity returns, `flushStorageQueue()` uploads the file
 * to Storage, gets the download URL, then writes the Firestore document.
 */

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage } from './firebase';
import { isOnline } from './offlineAuth';
import { toast } from 'sonner';

const DB_NAME = 'psm_offline_queue';
const DB_VERSION = 2; // bumped for new fileQueue store

type FileType = 'checkin_photo' | 'voice_note';

interface FileQueueItem {
  id?: number;
  fileType: FileType;
  storeName: string;       // Firestore collection (e.g. 'checkins')
  payload: Record<string, any>; // Firestore fields (excluding the file URL)
  urlField: string;        // field name that will hold the download URL
  fileName: string;        // Storage path
  mimeType: string;
  blobBase64: string;      // Blob stored as base64 data URL
  createdAt: number;
  retryCount: number;
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      // Create fileQueue if it doesn't exist
      if (!database.objectStoreNames.contains('fileQueue')) {
        database.createObjectStore('fileQueue', { keyPath: 'id', autoIncrement: true });
      }
      // Ensure other stores exist (backward compat)
      if (!database.objectStoreNames.contains('checkins')) {
        database.createObjectStore('checkins', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('leads')) {
        database.createObjectStore('leads', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('audio_notes')) {
        database.createObjectStore('audio_notes', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
}

/** Enqueue a file + metadata for later upload. */
export async function enqueueFileUpload(
  fileType: FileType,
  storeName: string,
  payload: Record<string, any>,
  urlField: string,
  fileName: string,
  blob: Blob,
): Promise<void> {
  const database = await openQueueDb();
  const blobBase64 = await blobToBase64(blob);
  return new Promise((resolve, reject) => {
    const tx = database.transaction('fileQueue', 'readwrite');
    const store = tx.objectStore('fileQueue');
    const item: Omit<FileQueueItem, 'id'> = {
      fileType,
      storeName,
      payload,
      urlField,
      fileName,
      mimeType: blob.type || 'application/octet-stream',
      blobBase64,
      createdAt: Date.now(),
      retryCount: 0,
    };
    const req = store.add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Get count of pending file uploads. */
export async function getFileQueueCount(): Promise<number> {
  try {
    const database = await openQueueDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('fileQueue', 'readonly');
      const req = tx.objectStore('fileQueue').count();
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

/** Flush all pending file uploads. Called when device comes back online. */
export async function flushStorageQueue(): Promise<void> {
  if (!isOnline()) return;

  try {
    const database = await openQueueDb();
    const items = await new Promise<FileQueueItem[]>((resolve, reject) => {
      const tx = database.transaction('fileQueue', 'readonly');
      const req = tx.objectStore('fileQueue').getAll();
      req.onsuccess = () => resolve(req.result as FileQueueItem[]);
      req.onerror = () => reject(req.error);
    });

    if (!items.length) return;

    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      try {
        const blob = base64ToBlob(item.blobBase64, item.mimeType);
        const storageRef = ref(storage, item.fileName);
        const uploadResult = await uploadBytes(storageRef, blob);
        const downloadURL = await getDownloadURL(uploadResult.ref);

        // Write to Firestore with the download URL
        await addDoc(collection(db, item.storeName), {
          ...item.payload,
          [item.urlField]: downloadURL,
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
        });

        // Remove from queue
        await new Promise<void>((resolve, reject) => {
          const delTx = database.transaction('fileQueue', 'readwrite');
          delTx.objectStore('fileQueue').delete(item.id!);
          delTx.oncomplete = () => resolve();
          delTx.onerror = () => reject(delTx.error);
        });

        successCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`File upload ${successCount} ခု sync အောင်မြင်ပါသည်`);
    }
    if (failCount > 0) {
      toast.error(`File upload ${failCount} ခု sync မအောင်မြင်ပါ`);
    }
  } catch {
    // ignore
  }
}

/** Upload a file to Storage with automatic offline fallback. */
export async function uploadFileWithFallback(
  fileType: FileType,
  storeName: string,
  payload: Record<string, any>,
  urlField: string,
  fileName: string,
  blob: Blob,
): Promise<string> {
  // Try online upload first
  try {
    const storageRef = ref(storage, fileName);
    const uploadResult = await uploadBytes(storageRef, blob);
    const downloadURL = await getDownloadURL(uploadResult.ref);
    return downloadURL;
  } catch (err: any) {
    // If network error, queue for later
    if (!isOnline() || err?.message?.toLowerCase().includes('network') || err?.code?.includes('network')) {
      await enqueueFileUpload(fileType, storeName, payload, urlField, fileName, blob);
      throw new Error('OFFLINE_QUEUED');
    }
    throw err;
  }
}
