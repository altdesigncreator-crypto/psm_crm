import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { isBiometricEnabledFor } from '@/lib/biometricAuth';
import type { RoleTier, Department } from '@/lib/permissions';

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: RoleTier;
  department: Department | null;
  status: 'active' | 'inactive';
}

interface AuthContextType {
  user: StaffUser | null;
  role: RoleTier | null;
  department: Department | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<StaffUser>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** True only when a "Remember me" session was silently restored on app
   * start and the user has biometric sign-in enrolled on this device. A
   * fresh email/password login never sets this — biometrics are an
   * alternative way in, not a second gate. */
  needsBiometricUnlock: boolean;
  completeBiometricUnlock: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadProfile(userId: string): Promise<StaffUser> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name, role, department_code, status')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('Could not load your staff profile. Contact your administrator.');
  }
  if (data.status !== 'active') {
    throw new Error('Your account has been deactivated. Contact your administrator.');
  }

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    role: data.role as RoleTier,
    department: (data.department_code as Department) ?? null,
    status: data.status as 'active' | 'inactive',
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsBiometricUnlock, setNeedsBiometricUnlock] = useState(false);

  const hydrate = useCallback(async (sessionUserId: string | null) => {
    if (!sessionUserId) {
      setUser(null);
      return;
    }
    try {
      const profile = await loadProfile(sessionUserId);
      setUser(profile);
    } catch {
      setUser(null);
      await supabase.auth.signOut();
    }
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      const restoredUserId = data.session?.user.id ?? null;
      // Session came back from storage without the user typing anything —
      // if they enrolled biometrics, offer the biometric sign-in gate.
      if (restoredUserId && isBiometricEnabledFor(restoredUserId)) {
        setNeedsBiometricUnlock(true);
      }
      hydrate(restoredUserId).finally(() => {
        if (active) setLoading(false);
      });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      hydrate(session?.user.id ?? null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [hydrate]);

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      throw new Error(error?.message === 'Invalid login credentials'
        ? 'Incorrect email or password.'
        : error?.message || 'Unable to sign in.');
    }
    const profile = await loadProfile(data.user.id);
    setUser(profile);
    // Signing in with email/password IS the authentication — never stack
    // the biometric gate on top of it.
    setNeedsBiometricUnlock(false);
    await supabase.from('audit_logs').insert({ action: 'login', performed_by: profile.id });
    return profile;
  }, []);

  const logout = useCallback(async () => {
    if (user) {
      await supabase.from('audit_logs').insert({ action: 'logout', performed_by: user.id });
    }
    await supabase.auth.signOut();
    setUser(null);
    setNeedsBiometricUnlock(false);
  }, [user]);

  const completeBiometricUnlock = useCallback(() => setNeedsBiometricUnlock(false), []);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id) await hydrate(data.session.user.id);
  }, [hydrate]);

  return (
    <AuthContext.Provider
      value={{ user, role: user?.role ?? null, department: user?.department ?? null, loading, login, logout, refreshProfile, needsBiometricUnlock, completeBiometricUnlock }}
    >
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
      department: null,
      loading: true,
      login: async () => { throw new Error('Auth Context not mounted'); },
      logout: async () => {},
      refreshProfile: async () => {},
      needsBiometricUnlock: false,
      completeBiometricUnlock: () => {},
    } as AuthContextType;
  }
  return context;
}
