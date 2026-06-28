import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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

// Define a structural interface representing your Firestore database entry
interface CustomFirestoreUser {
  uid: string;
  email: string;
  role: string;
  name: string;
  department: string;
  status: string;
  permissions?: string[];
  isOffline?: boolean;
}

interface AuthContextType {
  user: CustomFirestoreUser | null;
  role: string | null;
  loading: boolean;
  isOffline: boolean;
  login: (email: string, password: string) => Promise<CustomFirestoreUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CustomFirestoreUser | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOfflineState, setIsOfflineState] = useState(!isOnline());

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

  // Initialize session from localStorage on application bootstrap
  useEffect(() => {
    const savedSession = localStorage.getItem('psm_staff_session');
    if (savedSession) {
      try {
        const parsedUser = JSON.parse(savedSession) as CustomFirestoreUser;
        setUser(parsedUser);
        const normalized = normalizeRole(parsedUser.role);
        setRole(normalized);
        
        if (normalized) {
          invalidateStaleCache(normalized, getDepartment(normalized));
        }
      } catch (e) {
        console.error("Error parsing restoration session:", e);
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      // Query the direct Firestore users collection by fields
      const q = query(
        collection(db, 'users'),
        where('email', '==', email),
        where('password', '==', password)
      );
      
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        throw new Error('အီးမေးလ် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်။');
      }

      const userDoc = querySnapshot.docs[0];
      const data = userDoc.data();

      if (data.status !== 'Active') {
        throw new Error('သင်၏ အကောင့်မှာ ပိတ်သိမ်းခံထားရပါသည်။ Admin အား ဆက်သွယ်ပါ။');
      }

      const verifiedUser: CustomFirestoreUser = {
        uid: data.uid || userDoc.id,
        email: data.email,
        role: data.role,
        name: data.name || 'Agent',
        department: data.department || 'General',
        permissions: data.permissions || [],
      };

      // Handle offline caching configurations
      cacheCredentials(email, password);
      const normalized = normalizeRole(verifiedUser.role);
      if (normalized) {
        cacheUserProfile(verifiedUser.uid, verifiedUser.email, normalized, verifiedUser.name);
      }

      setUser(verifiedUser);
      setRole(normalized);
      return verifiedUser;

    } catch (err: any) {
      // Fallback behavior if connection is severed
      if (isNetworkError(err) || !navigator.onLine) {
        const offlineUser = attemptOfflineLogin(email, password);
        if (offlineUser) {
          const built: CustomFirestoreUser = {
            uid: offlineUser.uid,
            email: offlineUser.email,
            role: offlineUser.role,
            name: offlineUser.displayName || 'Offline Agent',
            department: 'General',
            status: 'Active',
            permissions: [],
            isOffline: true
          };
          setUser(built);
          setRole(normalizeRole(offlineUser.role));
          setIsOfflineState(true);
          return built;
        }
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem('psm_staff_session');
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
    return {
      user: null,
      role: null,
      loading: true,
      isOffline: false,
      login: async () => { throw new Error('Auth Context not mounted'); },
      logout: async () => {},
    };
  }
  return context;
}