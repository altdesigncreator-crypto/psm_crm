import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics } from 'firebase/analytics';
import { getMessaging, getToken, type Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: 'AIzaSyBozDUIsznaE9S2J_0qXXcxgEGIOXaBW5M',
  authDomain: 'psm-crm.firebaseapp.com',
  projectId: 'psm-crm',
  storageBucket: 'psm-crm.firebasestorage.app',
  messagingSenderId: '1067858536297',
  appId: '1:1067858536297:web:430f676d332b4591f4fff8',
  measurementId: 'G-LLKCDFM532',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const analytics = getAnalytics(app);

// Messaging (FCM) — lazy init to avoid errors in unsupported browsers
let messagingInstance: Messaging | null = null;
export function getFCM(): Messaging | null {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  if (!messagingInstance) {
    try {
      messagingInstance = getMessaging(app);
    } catch {
      return null;
    }
  }
  return messagingInstance;
}
export async function requestFCMToken(): Promise<string | null> {
  const m = getFCM();
  if (!m) return null;
  try {
    const token = await getToken(m, { vapidKey: 'BPUm5KTi4hBY8N0fWltKFPx1AOjX1i9d1w2a0i6nK1vJpQr0fH1xP9W4x5Y1z2A3B4C5D6E7F8G9H0I1J2K3L4M5N6O7P8Q9R0S1T2U3V4W5X6Y7Z8a9b0c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6s7t8u9v0w1x2y3z4A5B6C7D8E9F0G1H2I3J4K5L6M7N8O9P0Q1R2S3T4U5V6W7X8Y9Z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6A7B8C9D0E1F2G3H4I5J6K7L8M9N0O1P2Q3R4S5T6U7V8W9X0Y1Z2a3b4c5d6e7f8g9h0i1j2k3l4m5n6o7p8q9r0s1t2u3v4w5x6y7z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4a5B6c7D8e9F0g1H2i3J4k5L6m7N8o9P0q1R2s3T4u5V6w7X8y9Z0a1b2c3' });
    return token || null;
  } catch {
    return null;
  }
}

// Enable Firestore offline persistence so that onSnapshot still works
// when the device loses connectivity. Cached data is automatically
// returned first, then updated when the connection comes back.
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open — persistence can only be enabled in one tab at a time.
    console.warn('Firestore persistence: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    // Browser doesn't support IndexedDB persistence.
    console.warn('Firestore persistence: browser does not support IndexedDB');
  }
});
