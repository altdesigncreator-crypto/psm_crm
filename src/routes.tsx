import React from 'react';
import type { ReactNode } from 'react';
import { ProtectedRoute } from './components/ProtectedRoutes'; // Adjust this import location based on your project structure

import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import AddLead from './pages/AddLead';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import Notifications from './pages/Notifications';
import CheckIn from './pages/CheckIn';
import CheckInGallery from './pages/CheckInGallery';
import UserManagement from './pages/UserManagement';
import KPIBoard from './pages/KPIBoard';
import AgentDetail from './pages/AgentDetail';
import AuditLog from './pages/AuditLog';
import VoiceNotes from './pages/VoiceNotes';
import Settings from './pages/Settings';
import FileCloud from './pages/FileCloud';
import LeadMap from './pages/LeadMap';
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
    name: 'Register',
    path: '/register',
    element: (
      <ProtectedRoute isPublic>
        <Register />
      </ProtectedRoute>
    ),
    public: true,
  },
  {
    name: 'Dashboard',
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Add Lead',
    path: '/add-lead',
    element: (
      <ProtectedRoute>
        <AddLead />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Leads',
    path: '/leads',
    element: (
      <ProtectedRoute>
        <Leads />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Lead Detail',
    path: '/lead/:id',
    element: (
      <ProtectedRoute>
        <LeadDetail />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Notifications',
    path: '/notifications',
    element: (
      <ProtectedRoute>
        <Notifications />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Check-In',
    path: '/check-in',
    element: (
      <ProtectedRoute>
        <CheckIn />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Check-In Gallery',
    path: '/check-in-gallery',
    element: (
      <ProtectedRoute>
        <CheckInGallery />
      </ProtectedRoute>
    ),
  },
  {
    name: 'User Management',
    path: '/user-management',
    element: (
      <ProtectedRoute>
        <UserManagement />
      </ProtectedRoute>
    ),
  },
  {
    name: 'KPI Board',
    path: '/kpi-board',
    element: (
      <ProtectedRoute>
        <KPIBoard />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Agent Detail',
    path: '/agent/:email',
    element: (
      <ProtectedRoute>
        <AgentDetail />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Audit Log',
    path: '/audit-log',
    element: (
      <ProtectedRoute>
        <AuditLog />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Voice Notes',
    path: '/voice-notes',
    element: (
      <ProtectedRoute>
        <VoiceNotes />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Settings',
    path: '/settings',
    element: (
      <ProtectedRoute>
        <Settings />
      </ProtectedRoute>
    ),
  },
  {
    name: 'File Cloud',
    path: '/file-cloud',
    element: (
      <ProtectedRoute>
        <FileCloud />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Lead Map',
    path: '/lead-map',
    element: (
      <ProtectedRoute>
        <LeadMap />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Pipeline',
    path: '/pipeline',
    element: (
      <ProtectedRoute>
        <PipelineBoard />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Analytics',
    path: '/analytics',
    element: (
      <ProtectedRoute>
        <AdminAnalytics />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Check-In Map',
    path: '/check-in-map',
    element: (
      <ProtectedRoute>
        <CheckInMap />
      </ProtectedRoute>
    ),
  },
  {
    name: 'Role Management',
    path: '/role-management',
    element: (
      <ProtectedRoute>
        <RoleManagement />
      </ProtectedRoute>
    ),
  },
];