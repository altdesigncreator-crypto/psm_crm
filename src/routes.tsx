import React from 'react';
import type { ReactNode } from 'react';
import { ProtectedRoute } from './components/ProtectedRoutes';
import type { RouteKey } from '@/lib/permissions';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AddLead from './pages/AddLead';
import Leads from './pages/Leads';
import FollowUps from './pages/FollowUps';
import LeadDetail from './pages/LeadDetail';
import Notifications from './pages/Notifications';
import CheckIn from './pages/CheckIn';
import CheckInGallery from './pages/CheckInGallery';
import UserManagement from './pages/UserManagement';
import KPIBoard from './pages/KPIBoard';
import AgentDetail from './pages/AgentDetail';
import Settings from './pages/Settings';
import PipelineBoard from './pages/PipelineBoard';
import AdminAnalytics from './pages/AdminAnalytics';
import CheckInMap from './pages/CheckInMap';
import RoleManagement from './pages/RoleManagement';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. */
  public?: boolean;
  /** Key used by RouteGuard + the sidebar nav to check role-based access (see src/lib/permissions.ts). */
  routeKey?: RouteKey;
}

export const routes: RouteConfig[] = [
  {
    name: 'Login',
    path: '/login',
    element: (
      <ProtectedRoute isPublic>
        <Login />
      </ProtectedRoute>
    ),
    public: true,
  },
  {
    name: 'Dashboard',
    path: '/dashboard',
    routeKey: 'dashboard',
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Add Lead',
    path: '/add-lead',
    routeKey: 'add-lead',
    element: (
      <ProtectedRoute>
        <AddLead />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Leads',
    path: '/leads',
    routeKey: 'leads',
    element: (
      <ProtectedRoute>
        <Leads />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Follow-ups',
    path: '/follow-ups',
    routeKey: 'follow-ups',
    element: (
      <ProtectedRoute>
        <FollowUps />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Lead Detail',
    path: '/lead/:id',
    routeKey: 'lead-detail',
    element: (
      <ProtectedRoute>
        <LeadDetail />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Notifications',
    path: '/notifications',
    routeKey: 'notifications',
    element: (
      <ProtectedRoute>
        <Notifications />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Check-In',
    path: '/check-in',
    routeKey: 'check-in',
    element: (
      <ProtectedRoute>
        <CheckIn />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Check-In Gallery',
    path: '/check-in-gallery',
    routeKey: 'check-in-gallery',
    element: (
      <ProtectedRoute>
        <CheckInGallery />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Check-In Map',
    path: '/check-in-map',
    routeKey: 'check-in-map',
    element: (
      <ProtectedRoute>
        <CheckInMap />
      </ProtectedRoute>
    ),
  },
  {
    name: 'User Management',
    path: '/user-management',
    routeKey: 'user-management',
    element: (
      <ProtectedRoute>
        <UserManagement />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Role Reference',
    path: '/role-management',
    routeKey: 'role-management',
    element: (
      <ProtectedRoute>
        <RoleManagement />
      </ProtectedRoute>
    ),
  },
  {
    name: 'KPI Board',
    path: '/kpi-board',
    routeKey: 'kpi-board',
    element: (
      <ProtectedRoute>
        <KPIBoard />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Agent Detail',
    path: '/agent/:id',
    routeKey: 'agent-detail',
    element: (
      <ProtectedRoute>
        <AgentDetail />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Settings',
    path: '/settings',
    routeKey: 'settings',
    element: (
      <ProtectedRoute>
        <Settings />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Pipeline',
    path: '/pipeline',
    routeKey: 'pipeline',
    element: (
      <ProtectedRoute>
        <PipelineBoard />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Analytics',
    path: '/analytics',
    routeKey: 'analytics',
    element: (
      <ProtectedRoute>
        <AdminAnalytics />
      </ProtectedRoute>
    ),
  },
];
