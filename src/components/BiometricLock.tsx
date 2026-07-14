import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { verifyBiometric } from '@/lib/biometricAuth';
import { Button } from '@/components/ui/button';
import { FingerprintPattern, Loader2, Mail } from 'lucide-react';

interface BiometricLockProps {
  onUnlock: () => void;
}

/** Sign-in choice screen shown when a "Remember me" session was silently
 * restored on app start and this device has biometric sign-in enrolled for
 * that user. The user picks how to sign in: biometrics (reveals the session
 * Supabase already restored) or email & password (signs the restored session
 * out and returns to the Login form). It never appears after a fresh
 * password login — see AuthContext. */
export default function BiometricLock({ onUnlock }: BiometricLockProps) {
  const { user, logout } = useAuth();
  const [verifying, setVerifying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const signInWithBiometrics = async () => {
    if (!user) return;
    setVerifying(true);
    setFailed(false);
    const ok = await verifyBiometric(user.id);
    setVerifying(false);
    if (ok) onUnlock();
    else setFailed(true);
  };

  const signInWithPassword = async () => {
    setSigningOut(true);
    // Drops the restored session so the Login form takes over.
    await logout();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
      <div className="w-full max-w-sm animate-fade-in-up text-center bg-white rounded-lg shadow-card p-8 space-y-6">
        <img src="/logo.png" alt="PSM Properties" className="h-16 w-auto mx-auto" draggable={false} />
        <div>
          <h1 className="text-lg font-semibold text-foreground">Welcome back{user ? `, ${user.name}` : ''}</h1>
          <p className="text-sm text-muted-foreground mt-1">Choose how you want to sign in</p>
        </div>

        <button
          type="button"
          onClick={signInWithBiometrics}
          disabled={verifying || signingOut}
          className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors"
          aria-label="Sign in with biometrics"
        >
          {verifying ? (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          ) : (
            <FingerprintPattern className="w-8 h-8 text-primary" />
          )}
        </button>

        {failed && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            Biometric verification failed or was cancelled. Try again or use your password.
          </p>
        )}

        <div className="space-y-2">
          <Button
            onClick={signInWithBiometrics}
            disabled={verifying || signingOut}
            className="w-full h-11 gradient-primary text-white"
          >
            {verifying ? 'Verifying…' : 'Sign in with Biometrics'}
          </Button>
          <Button
            variant="outline"
            onClick={signInWithPassword}
            disabled={verifying || signingOut}
            className="w-full h-11"
          >
            <Mail className="w-4 h-4 mr-2" />
            {signingOut ? 'Switching…' : 'Sign in with Email & Password'}
          </Button>
        </div>
      </div>
    </div>
  );
}
