/**
 * Offline Authentication Service
 * Caches credentials and user profile for login during poor network conditions.
 */

const CACHE_KEY = 'psm_offline_auth';
const USER_KEY = 'psm_offline_user';

export interface CachedAuth {
  email: string;
  passwordHash: string;
  cachedAt: number;
}

export interface CachedUser {
  uid: string;
  email: string;
  role: string;
  displayName?: string;
  cachedAt: number;
}

/** Simple hash for localStorage password storage (not cryptographically secure, just obfuscation) */
function hashString(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    h = (h << 5) - h + char;
    h |= 0;
  }
  return btoa(String.fromCharCode(...new Uint8Array(new Int32Array([h]).buffer)));
}

/** Check if device is currently online */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

/** Detect if an error is a network failure */
export function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toLowerCase();
  return (
    code.includes('network-request-failed') ||
    code.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('internet') ||
    msg.includes('offline') ||
    msg.includes('connection')
  );
}

/** Cache credentials after successful online login */
export function cacheCredentials(email: string, password: string): void {
  try {
    const data: CachedAuth = {
      email: email.toLowerCase().trim(),
      passwordHash: hashString(password),
      cachedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // silently ignore storage errors
  }
}

/** Retrieve cached credentials */
export function getCachedCredentials(): CachedAuth | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedAuth;
  } catch {
    return null;
  }
}

/** Clear cached credentials */
export function clearCachedCredentials(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

/** Attempt offline login using cached credentials */
export function attemptOfflineLogin(email: string, password: string): CachedUser | null {
  const cached = getCachedCredentials();
  if (!cached) return null;
  if (cached.email !== email.toLowerCase().trim()) return null;
  if (cached.passwordHash !== hashString(password)) return null;

  // Match — return stored user profile
  try {
    const rawUser = localStorage.getItem(USER_KEY);
    if (rawUser) {
      const user = JSON.parse(rawUser) as CachedUser;
      return { ...user, cachedAt: Date.now() };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Cache user profile for offline access */
export function cacheUserProfile(uid: string, email: string, role: string, displayName?: string): void {
  try {
    const data: CachedUser = {
      uid,
      email: email.toLowerCase().trim(),
      role,
      displayName,
      cachedAt: Date.now(),
    };
    localStorage.setItem(USER_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

/** Get cached user profile */
export function getCachedUserProfile(): CachedUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedUser;
  } catch {
    return null;
  }
}
