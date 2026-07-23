import { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import { cacheGet, cacheSet } from '@/lib/localCache';
import type { MaintenanceSettings } from '@/types';

const CACHE_KEY = 'maintenance_settings';
// Backstop only — the Realtime subscription below already keeps this live,
// and every mount re-fetches in the background regardless of the cache hit.
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Whether the site-wide maintenance gate is currently on — checked before
 * anything else renders (see App.tsx), and kept live via Realtime so an
 * already-open tab flips to the gate (or back) without needing a refresh.
 * Boots instantly from the last known value on repeat visits (a cache hit
 * skips the loading state entirely) while still refreshing from the network
 * right away in the background to catch anything toggled while offline.
 * Fails OPEN: any read error (including the table not existing yet, before
 * the migration has been run) is treated as "not in maintenance" rather
 * than locking everyone out over a transient/setup issue. */
export function useMaintenanceStatus() {
  const cached = cacheGet<MaintenanceSettings | null>(CACHE_KEY, CACHE_TTL_MS);
  const [settings, setSettings] = useState<MaintenanceSettings | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from('maintenance_settings').select('*').eq('id', 1).maybeSingle();
      if (!active) return;
      const resolved = error ? null : (data as MaintenanceSettings) || null;
      setSettings(resolved);
      setLoading(false);
      cacheSet(CACHE_KEY, resolved);
    };
    load();

    const channel = supabase
      .channel('maintenance-settings-gate')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_settings' }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  return { isEnabled: !!settings?.is_enabled, settings, loading };
}
