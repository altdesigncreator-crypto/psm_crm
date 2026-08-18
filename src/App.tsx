import React, { Suspense, useCallback, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import SplashScreen from '@/components/common/SplashScreen';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import UpdatePrompt from '@/components/UpdatePrompt';
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
import ScreenshotGuard from '@/components/ScreenshotGuard';
import { useMaintenanceStatus } from '@/hooks/useMaintenanceStatus';

import { routes } from './routes';

const FullScreenLoader: React.FC = () => (
  <div className="flex h-screen w-screen items-center justify-center bg-background">
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

/** Content-area-only loading state used while a lazy page chunk loads —
 * scoped inside AppLayout's <main> so the sidebar/navbar never unmount. */
const PageLoader: React.FC = () => (
  <div className="flex h-full w-full items-center justify-center py-24">
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

const AppContent: React.FC = () => {
  const { user, loading, needsBiometricUnlock, completeBiometricUnlock } = useAuth();
  const location = useLocation();
  const { isEnabled: maintenanceOn, settings: maintenanceSettings, loading: maintenanceLoading } = useMaintenanceStatus();
  const [splashDone, setSplashDone] = useState(false);
  const stillLoading = loading || maintenanceLoading;
  const handleSplashFinish = useCallback(() => setSplashDone(true), []);

  if (!splashDone) {
    return <SplashScreen loading={stillLoading} onFinish={handleSplashFinish} />;
  }

  if (maintenanceOn && !location.pathname.startsWith('/system-banner-admin')) {
    return <MaintenancePage settings={maintenanceSettings} />;
  }

  if (user && needsBiometricUnlock) {
    return <BiometricLock onUnlock={completeBiometricUnlock} />;
  }

  return (
    <RouteGuard>
      <IntersectObserver />
      <PWAInstallPrompt />
      <UpdatePrompt />
      {/* First-time-use camera & GPS permission onboarding (signed-in only) */}
      {user && <PermissionPrimer />}
      <Routes>
        {/* Public Routes (Login, registration panels) — their own chunk load
            happens before AppLayout ever mounts, so a full-screen fallback
            here is fine. */}
        {routes
          .filter((r) => r.public)
          .map((route, index) => (
            <Route
              key={index}
              path={route.path}
              element={
                <Suspense fallback={<FullScreenLoader />}>
                  {route.element}
                </Suspense>
              }
            />
          ))}

        {/* Core Protected Internal Application Layout Wrapper.
            The Suspense boundary sits INSIDE AppLayout, around only the
            page content — so the sidebar/navbar mount once and stay
            mounted across every navigation, instead of unmounting and
            re-mounting every time a not-yet-loaded page chunk suspends. */}
        <Route
          path="/*"
          element={
            <PageHeaderProvider>
              <ScreenshotGuard>
                <AppLayout>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      {routes
                        .filter((r) => !r.public)
                        .map((route, index) => (
                          <Route key={index} path={route.path} element={route.element} />
                        ))}
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </Suspense>
                </AppLayout>
              </ScreenshotGuard>
            </PageHeaderProvider>
          }
        />
      </Routes>
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