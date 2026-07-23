import React, { Suspense, useCallback, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import SplashScreen from '@/components/common/SplashScreen';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import PermissionPrimer from '@/components/PermissionPrimer';
import BiometricLock from '@/components/BiometricLock';
import MaintenancePage from '@/components/MaintenancePage';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { TranslationProvider } from '@/contexts/TranslationContext';
import { PageHeaderProvider } from '@/contexts/PageHeaderContext';
import { RouteGuard } from '@/components/common/RouteGuard';
import AppLayout from '@/components/layouts/AppLayout';
import { useMaintenanceStatus } from '@/hooks/useMaintenanceStatus';

import { routes } from './routes';

const AppContent: React.FC = () => {
  const { user, loading, needsBiometricUnlock, completeBiometricUnlock } = useAuth();
  const location = useLocation();
  const { isEnabled: maintenanceOn, settings: maintenanceSettings, loading: maintenanceLoading } = useMaintenanceStatus();
  const [splashDone, setSplashDone] = useState(false);
  const stillLoading = loading || maintenanceLoading;
  const handleSplashFinish = useCallback(() => setSplashDone(true), []);

  // The branded intro doubles as the loading screen while the Supabase
  // auth session settles and the maintenance check resolves — one loading
  // experience. It stays mounted (rather than being swapped out the instant
  // loading flips false) so it can finish its own race-to-100%/fade-out
  // animation and only then hand control back via onFinish.
  if (!splashDone) {
    return <SplashScreen loading={stillLoading} onFinish={handleSplashFinish} />;
  }

  // Site-wide maintenance gate — blocks every visitor, signed in or not,
  // even one with the app already open (useMaintenanceStatus updates live).
  // /system-banner-admin is the one route that must never be blocked, since
  // that's the only place this can be turned back off.
  if (maintenanceOn && !location.pathname.startsWith('/system-banner-admin')) {
    return <MaintenancePage settings={maintenanceSettings} />;
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
            <PageHeaderProvider>
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
            </PageHeaderProvider>
          }
        />
      </Routes>
      </Suspense>
      <Toaster />
    </RouteGuard>
  );
};

const App: React.FC = () => {
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