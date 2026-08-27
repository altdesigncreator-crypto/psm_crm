import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const PsmMapCanvas = lazy(() => import('./PsmMapCanvas'));
const PSM_MAP_PATH = '/psm-map';

/**
 * Rendered once inside AppLayout (which itself never unmounts — see
 * App.tsx) and kept alive here for the rest of the session instead of
 * tearing the map down and reinitializing it (fresh tile/parcel fetches)
 * every time the user tabs away and back, the way a normal routed page
 * would.
 *
 * PsmMapCanvas (and the maplibre-gl library it pulls in) is lazy-loaded on
 * top of that — not bundled into the app's main chunk, only fetched the
 * first time the user actually opens this tab.
 */
export default function PsmMapFrame() {
  const location = useLocation();
  const isActive = location.pathname === PSM_MAP_PATH;
  const [everVisited, setEverVisited] = useState(false);

  useEffect(() => {
    if (isActive) setEverVisited(true);
  }, [isActive]);

  if (!everVisited) return null;

  return (
    <div className={isActive ? 'absolute inset-0 z-10 bg-background' : 'hidden'} aria-hidden={!isActive}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <PsmMapCanvas />
      </Suspense>
    </div>
  );
}
