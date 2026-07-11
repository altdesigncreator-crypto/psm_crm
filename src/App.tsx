import React, { useState, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import SplashScreen from '@/components/common/SplashScreen';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import PermissionPrimer from '@/components/PermissionPrimer';
import BiometricLock from '@/components/BiometricLock';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { TranslationProvider } from '@/contexts/TranslationContext';
import { RouteGuard } from '@/components/common/RouteGuard';
import AppLayout from '@/components/layouts/AppLayout';

import { routes } from './routes';

const AppContent: React.FC = () => {
  const { user, loading, needsBiometricUnlock, completeBiometricUnlock } = useAuth();

  // Wait for the Supabase auth session to settle before rendering routes
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#F8FAFC]">
        <div className="animate-pulse text-sm font-medium text-muted-foreground">
          Workspace Synchronization...
        </div>
      </div>
    );
  }

  // A "Remember me" session was silently restored on this app load and the
  // user enrolled Face ID / Fingerprint on this device — let them choose to
  // sign in with biometrics or fall back to email & password. A fresh
  // password login never lands here (see AuthContext).
  if (user && needsBiometricUnlock) {
    return <BiometricLock onUnlock={completeBiometricUnlock} />;
  }

  return (
    <RouteGuard>
      <IntersectObserver />
      <PWAInstallPrompt />
      {/* First-time-use camera & GPS permission onboarding (signed-in only) */}
      {user && <PermissionPrimer />}
      <Suspense
        fallback={
          <div className="flex h-screen w-screen items-center justify-center bg-background">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
      <Routes>
        {/* Public Routes (Login, registration panels) */}
        {routes
          .filter((r) => r.public)
          .map((route, index) => (
            <Route key={index} path={route.path} element={route.element} />
          ))}
        
        {/* Core Protected Internal Application Layout Wrapper */}
        <Route
          path="/*"
          element={
            <AppLayout>
              <Routes>
                {routes
                  .filter((r) => !r.public)
                  .map((route, index) => (
                    <Route key={index} path={route.path} element={route.element} />
                  ))}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </AppLayout>
          }
        />
      </Routes>
      </Suspense>
      <Toaster />
    </RouteGuard>
  );
};

const App: React.FC = () => {
  // The animated splash plays once per browser session — replaying its
  // ~3.4s sequence on every refresh made the whole app feel slow.
  const [splashDone, setSplashDone] = useState(() => sessionStorage.getItem('psm_splash_shown') === '1');

  if (!splashDone) {
    return (
      <SplashScreen
        onFinish={() => {
          sessionStorage.setItem('psm_splash_shown', '1');
          setSplashDone(true);
        }}
      />
    );
  }

  return (
    <AuthProvider>
      <Router>
        <TranslationProvider>
          <NotificationsProvider>
            <AppContent />
          </NotificationsProvider>
        </TranslationProvider>
      </Router>
    </AuthProvider>
  );
};

export default App;