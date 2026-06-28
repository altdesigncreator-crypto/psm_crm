import React from 'react';
import { Navigate } from 'react-router-dom';

interface GuardProps {
  children: React.ReactNode;
  isPublic?: boolean;
}

export function ProtectedRoute({ children, isPublic = false }: GuardProps) {
  // Read custom session target matching your settings layout strategy
  const sessionRaw = localStorage.getItem('psm_staff_session');
  const isAuthenticated = !!sessionRaw;

  if (!isAuthenticated && !isPublic) {
    // Force bounce to sign-in page if session metadata context isn't set up
    return <Navigate to="/login" replace />;
  }

  if (isAuthenticated && isPublic) {
    // Send active sessions away from auth gates straight to terminal workspace
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}