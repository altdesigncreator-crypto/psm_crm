import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import SplashScreen from '@/components/common/SplashScreen';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { TranslationProvider } from '@/contexts/TranslationContext';
import { RouteGuard } from '@/components/common/RouteGuard';
import AppLayout from '@/components/layouts/AppLayout';

import { routes } from './routes';

const App: React.FC = () => {
  const [splashDone, setSplashDone] = useState(false);

  if (!splashDone) {
    return <SplashScreen onFinish={() => setSplashDone(true)} />;
  }

  return (
    <Router>
      <AuthProvider>
        <TranslationProvider>
        <NotificationsProvider>
        <RouteGuard>
          <IntersectObserver />
          <PWAInstallPrompt />
          <Routes>
            {routes
              .filter((r) => r.public)
              .map((route, index) => (
                <Route key={index} path={route.path} element={route.element} />
              ))}
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
        </NotificationsProvider>
        </TranslationProvider>
      </AuthProvider>
    </Router>
  );
};

export default App;
