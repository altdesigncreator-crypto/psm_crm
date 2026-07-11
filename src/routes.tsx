import React, { lazy } from 'react';
import type { ReactNode } from 'react';
import { ProtectedRoute } from './components/ProtectedRoutes';
import type { RouteKey } from '@/lib/permissions';

// Every page is lazy-loaded so the initial bundle only carries the app
// shell — each route's code downloads the first time it's visited (and is
// then cached). The Suspense fallback lives in App.tsx.
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AddLead = lazy(() => import('./pages/AddLead'));
const Leads = lazy(() => import('./pages/Leads'));
const FollowUps = lazy(() => import('./pages/FollowUps'));
const LeadDetail = lazy(() => import('./pages/LeadDetail'));
const Notifications = lazy(() => import('./pages/Notifications'));
const CheckIn = lazy(() => import('./pages/CheckIn'));
const CheckInGallery = lazy(() => import('./pages/CheckInGallery'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const KPIBoard = lazy(() => import('./pages/KPIBoard'));
const AgentDetail = lazy(() => import('./pages/AgentDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const PipelineBoard = lazy(() => import('./pages/PipelineBoard'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const CheckInMap = lazy(() => import('./pages/CheckInMap'));
const RoleManagement = lazy(() => import('./pages/RoleManagement'));

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
