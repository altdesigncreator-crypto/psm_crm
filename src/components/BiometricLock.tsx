import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { verifyBiometric } from '@/lib/biometricAuth';
import { Button } from '@/components/ui/button';
import { Building2, FingerprintPattern, Loader2 } from 'lucide-react';

interface BiometricLockProps {
  onUnlock: () => void;
}

/** Full-screen gate shown when a "Remember me" session was silently restored
 * on app start and this device has biometric unlock enabled for that user.
 * It never creates a new session — it only decides whether to reveal the one
 * Supabase already restored (see src/db/supabase.ts + biometricAuth.ts). */
export default function BiometricLock({ onUnlock }: BiometricLockProps) {
  const { user, logout } = useAuth();
  const [verifying, setVerifying] = useState(false);
  const [failed, setFailed] = useState(false);

  const attempt = async () => {
    if (!user) return;
    setVerifying(true);
    setFailed(false);
    const ok = await verifyBiometric(user.id);
    setVerifying(false);
    if (ok) onUnlock();
    else setFailed(true);
  };

  useEffect(() => {
    attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUsePassword = async () => {
    await logout();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
      <div className="w-full max-w-sm animate-fade-in-up text-center bg-white rounded-lg shadow-card p-8 space-y-6">
        <div className="w-14 h-14 rounded-xl gradient-primary flex items-center justify-center mx-auto shadow-card">
          <Building2 className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Welcome back{user ? `, ${user.name}` : ''}</h1>
          <p className="text-sm text-muted-foreground mt-1">Unlock with Face ID / Fingerprint to continue</p>
        </div>

        <button
          type="button"
          onClick={attempt}
          disabled={verifying}
          className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors"
          aria-label="Unlock with biometrics"
        >
          {verifying ? (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          ) : (
            <FingerprintPattern className="w-8 h-8 text-primary" />
          )}
        </button>

        {failed && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            Biometric verification failed or was cancelled. Try again.
          </p>
        )}

        <div className="space-y-2">
          <Button onClick={attempt} disabled={verifying} className="w-full h-11 gradient-primary text-white">
            {verifying ? 'Verifying…' : 'Try Again'}
          </Button>
          <Button variant="ghost" onClick={handleUsePassword} className="w-full h-11 text-muted-foreground">
            Use password instead
          </Button>
        </div>
      </div>
    </div>
  );
}
