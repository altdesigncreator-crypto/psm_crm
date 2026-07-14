import React, { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Info, AlertTriangle, Wrench, Siren, X } from 'lucide-react';
import type { SystemMessage, SystemMessageType } from '@/types';

const DISMISS_KEY = 'psm_banner_dismissed';

const TYPE_ICON: Record<SystemMessageType, React.ComponentType<{ className?: string }>> = {
  info: Info, warning: AlertTriangle, maintenance: Wrench, critical: Siren,
};
const TYPE_STYLE: Record<SystemMessageType, string> = {
  info: 'bg-info/10 text-info border-info/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  maintenance: 'bg-primary/10 text-primary border-primary/30',
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
};

/** Site-wide announcement bar — reads the active row from
 * public.system_messages (readable by anyone, signed in or not, per RLS in
 * database/crm.sql section 16) and updates live via Realtime. Managed at
 * /system-banner-admin, a login unrelated to any CRM staff account. */
export default function SystemBanner() {
  const [active, setActive] = useState<SystemMessage | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => sessionStorage.getItem(DISMISS_KEY));

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from('system_messages')
        .select('*')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (mounted) setActive((data?.[0] as SystemMessage) || null);
    };
    load();

    const channel = supabase
      .channel('system-messages-banner')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_messages' }, load)
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, []);

  if (!active) return null;

  const dismissKeyForMessage = `${active.id}:${active.updated_at}`;
  if (dismissedKey === dismissKeyForMessage) return null;

  const Icon = TYPE_ICON[active.type];

  return (
    <div className={`flex items-center gap-2.5 px-4 py-2 border-b text-sm ${TYPE_STYLE[active.type]}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <p className="flex-1 min-w-0 font-medium leading-snug">{active.message}</p>
      <button
        type="button"
        onClick={() => { sessionStorage.setItem(DISMISS_KEY, dismissKeyForMessage); setDismissedKey(dismissKeyForMessage); }}
        className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
