import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import SplashScreen from '@/components/common/SplashScreen';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { TranslationProvider } from '@/contexts/TranslationContext';
import { RouteGuard } from '@/components/common/RouteGuard';
import AppLayout from '@/components/layouts/AppLayout';

import { routes } from './routes';

const AppContent: React.FC = () => {
  const { loading } = useAuth();

  // Wait for the central Firebase authentication layer to settle completely
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#F8FAFC]">
        <div className="animate-pulse text-sm font-medium text-muted-foreground">
          Workspace Synchronization...
        </div>
      </div>
    );
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