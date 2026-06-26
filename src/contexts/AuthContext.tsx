import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  isOnline,
  isNetworkError,
  cacheCredentials,
  cacheUserProfile,
  attemptOfflineLogin,
  getCachedUserProfile,
  clearCachedCredentials,
} from '@/lib/offlineAuth';
import { normalizeRole, getDepartment } from '@/lib/roleUtils';
import { invalidateStaleCache, clearAllCache } from '@/lib/offlineDataCache';

interface OfflineUser {
  uid: string;
  email: string;
  role: string;
  displayName?: string;
  isOffline: true;
}

interface AuthContextType {
  user: User | null;
  role: string | null;
  loading: boolean;
  isOffline: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function buildOfflineUser(cached: { uid: string; email: string; role: string; displayName?: string }): OfflineUser {
  return {
    uid: cached.uid,
    email: cached.email,
    role: cached.role,
    displayName: cached.displayName,
    isOffline: true,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOfflineState, setIsOfflineState] = useState(!isOnline());

  // Network status listener
  useEffect(() => {
    const handleOnline = () => setIsOfflineState(false);
    const handleOffline = () => setIsOfflineState(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOfflineState(!navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Auth state listener — reads role from custom claims first, Firestore as fallback
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        try {
          // 1. Try custom claims first (most secure, included in ID token)
          const idTokenResult = await currentUser.getIdTokenResult(true);
          const claimRole = idTokenResult.claims.role as string | undefined;

          if (claimRole) {
            const normalized = normalizeRole(claimRole);
            setRole(normalized);
            if (normalized) {
              cacheUserProfile(currentUser.uid, currentUser.email || '', normalized, currentUser.displayName || undefined);
              invalidateStaleCache(normalized, getDepartment(normalized));
            }
          } else {
            // 2. Fallback to Firestore users/{uid} document
            const snap = await getDoc(doc(db, 'users', currentUser.uid));
            const roleValue = snap.exists() ? normalizeRole(snap.data().role as string) : null;
            setRole(roleValue);
            if (roleValue) {
              cacheUserProfile(currentUser.uid, currentUser.email || '', roleValue, currentUser.displayName || undefined);
              invalidateStaleCache(roleValue, getDepartment(roleValue));
            }
          }
        } catch {
          // If both claims and Firestore fail, try cached role
          const cached = getCachedUserProfile();
          if (cached && cached.uid === currentUser.uid) {
            const normalized = normalizeRole(cached.role);
            setRole(normalized);
            if (normalized) {
              invalidateStaleCache(normalized, getDepartment(normalized));
            }
          } else {
            setRole(null);
          }
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Online success — cache credentials and profile
      cacheCredentials(email, password);
    } catch (err: any) {
      if (isNetworkError(err)) {
        // Fallback to offline authentication
        const offlineUser = attemptOfflineLogin(email, password);
        if (offlineUser) {
          const built = buildOfflineUser(offlineUser);
          setUser(built as unknown as User);
          setRole(offlineUser.role);
          setIsOfflineState(true);
          return;
        }
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
    } catch {
      // Even if Firebase signOut fails (offline), clear local state
    }
    setUser(null);
    setRole(null);
    clearCachedCredentials();
    clearAllCache();
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, loading, isOffline: isOfflineState, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    // During React Fast Refresh (HMR), context can be briefly undefined
    // while the provider is being remounted. Return safe defaults instead
    // of throwing to prevent the app from crashing during development.
    return {
      user: null,
      role: null,
      loading: true,
      isOffline: false,
      login: async () => {},
      logout: async () => {},
    };
  }
  return context;
}
