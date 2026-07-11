import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface GuardProps {
  children: React.ReactNode;
  isPublic?: boolean;
}

export function ProtectedRoute({ children, isPublic = false }: GuardProps) {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (!user && !isPublic) {
    return <Navigate to="/login" replace />;
  }

  if (user && isPublic) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
