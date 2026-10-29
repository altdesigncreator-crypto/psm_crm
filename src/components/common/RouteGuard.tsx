import { useEffect } from 'react';
import { useNavigate, useLocation, matchPath } from 'react-router-dom';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
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
  const { user, role, loading, rbac, retryRbac } = useAuth();
  const { t } = useTranslation();
  // Without the role catalog every permission check fails closed. That means
  // "not known yet", not "denied" — so never redirect (or render pages that
  // would wrongly show "access denied") until it's here.
  const awaitingAccess = !!user && !rbac.loaded;
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;

    const isPublic = matchPublicRoute(location.pathname, PUBLIC_ROUTES);

    if (!user && !isPublic) {
      navigate('/login', { state: { from: location.pathname }, replace: true });
      return;
    }

    if (user && !isPublic && !awaitingAccess && findBlockedRoute(location.pathname, role)) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, role, loading, awaitingAccess, location.pathname, navigate]);

  if (awaitingAccess && rbac.failed && !matchPublicRoute(location.pathname, PUBLIC_ROUTES)) {
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">{t('access.loadErrorTitle')}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t('access.loadErrorBody')}</p>
        <Button variant="outline" className="mt-2 h-11 gap-2" onClick={retryRbac}>
          <RefreshCw className="h-4 w-4" /> {t('access.retry')}
        </Button>
      </div>
    );
  }

  if (loading || (awaitingAccess && !matchPublicRoute(location.pathname, PUBLIC_ROUTES))) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
