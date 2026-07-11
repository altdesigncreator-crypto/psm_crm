import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import SplashScreen from '@/components/common/SplashScreen';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import BiometricLock from '@/components/BiometricLock';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { TranslationProvider } from '@/contexts/TranslationContext';
import { RouteGuard } from '@/components/common/RouteGuard';
import AppLayout from '@/components/layouts/AppLayout';
import { isBiometricEnabledFor } from '@/lib/biometricAuth';

import { routes } from './routes';

const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [unlocked, setUnlocked] = useState(false);

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

  // A "Remember me" session was silently restored on this app load, and the
  // signed-in user previously enrolled Face ID / Fingerprint on this device
  // — require that biometric check before showing anything else.
  if (user && !unlocked && isBiometricEnabledFor(user.id)) {
    return <BiometricLock onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <RouteGuard>
      <IntersectObserver />
      <PWAInstallPrompt />
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
      <Toaster />
    </RouteGuard>
  );
};

const App: React.FC = () => {
  const [splashDone, setSplashDone] = useState(false);

  if (!splashDone) {
    return <SplashScreen onFinish={() => setSplashDone(true)} />;
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