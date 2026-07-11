import { useEffect } from 'react';
import { useNavigate, useLocation, matchPath } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessRoute } from '@/lib/permissions';
import { routes } from '@/routes';

interface RouteGuardProps {
  children: React.ReactNode;
}

const SYSTEM_PUBLIC_ROUTES = ['/login', '/403', '/404'];
const routePublicPaths = routes.filter((r) => r.public).map((r) => r.path);
const PUBLIC_ROUTES = [...SYSTEM_PUBLIC_ROUTES, ...routePublicPaths];

function matchPublicRoute(path: string, patterns: string[]) {
  return patterns.some((pattern) => matchPath(pattern, path) !== null || path === pattern);
}

/** The real UX-level route access check — RLS in Postgres is the actual
 * security boundary, but this stops staff from ever *seeing* pages their
 * role has no business in (previously there was no route-level check at all). */
function findBlockedRoute(pathname: string, role: ReturnType<typeof useAuth>['role']) {
  const matched = routes.find((r) => !r.public && matchPath(r.path, pathname));
  if (!matched?.routeKey) return false;
  return !canAccessRoute(role, matched.routeKey);
}

export function RouteGuard({ children }: RouteGuardProps) {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;

    const isPublic = matchPublicRoute(location.pathname, PUBLIC_ROUTES);

    if (!user && !isPublic) {
      navigate('/login', { state: { from: location.pathname }, replace: true });
      return;
    }

    if (user && !isPublic && findBlockedRoute(location.pathname, role)) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, role, loading, location.pathname, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
