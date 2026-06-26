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
import type { ReactNode } from 'react';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. Has no effect when RouteGuard is not in use. */
  public?: boolean;
}

export const routes: RouteConfig[] = [
  {
    name: 'Login',
    path: '/login',
    element: <Login />,
    public: true,
  },
  {
    name: 'Register',
    path: '/register',
    element: <Register />,
    public: true,
  },
  {
    name: 'Dashboard',
    path: '/dashboard',
    element: <Dashboard />,
  },
  {
    name: 'Add Lead',
    path: '/add-lead',
    element: <AddLead />,
  },
  {
    name: 'Leads',
    path: '/leads',
    element: <Leads />,
  },
  {
    name: 'Lead Detail',
    path: '/lead/:id',
    element: <LeadDetail />,
  },
  {
    name: 'Notifications',
    path: '/notifications',
    element: <Notifications />,
  },
  {
    name: 'Check-In',
    path: '/check-in',
    element: <CheckIn />,
  },
  {
    name: 'Check-In Gallery',
    path: '/check-in-gallery',
    element: <CheckInGallery />,
  },
  {
    name: 'User Management',
    path: '/user-management',
    element: <UserManagement />,
  },
  {
    name: 'KPI Board',
    path: '/kpi-board',
    element: <KPIBoard />,
  },
  {
    name: 'Agent Detail',
    path: '/agent/:email',
    element: <AgentDetail />,
  },
  {
    name: 'Audit Log',
    path: '/audit-log',
    element: <AuditLog />,
  },
  {
    name: 'Voice Notes',
    path: '/voice-notes',
    element: <VoiceNotes />,
  },
  {
    name: 'Settings',
    path: '/settings',
    element: <Settings />,
  },
  {
    name: 'File Cloud',
    path: '/file-cloud',
    element: <FileCloud />,
  },
  {
    name: 'Lead Map',
    path: '/lead-map',
    element: <LeadMap />,
  },
  {
    name: 'Pipeline',
    path: '/pipeline',
    element: <PipelineBoard />,
  },
  {
    name: 'Analytics',
    path: '/analytics',
    element: <AdminAnalytics />,
  },
  {
    name: 'Check-In Map',
    path: '/check-in-map',
    element: <CheckInMap />,
  },
];
