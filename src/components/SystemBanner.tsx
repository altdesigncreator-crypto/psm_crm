import React, { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Info, AlertTriangle, Wrench, Siren, X } from 'lucide-react';
import type { SystemMessage, SystemMessageType } from '@/types';

const DISMISS_KEY = 'psm_banner_dismissed';

const TYPE_ICON: Record<SystemMessageType, React.ComponentType<{ className?: string }>> = {
  info: Info, warning: AlertTriangle, maintenance: Wrench, critical: Siren,
};
// Left accent + soft fill for the bar, solid color for the icon badge —
// keeps the message text itself neutral/readable instead of tinted.
const TYPE_STYLE: Record<SystemMessageType, { bar: string; badge: string }> = {
  info: { bar: 'border-l-info bg-info/5', badge: 'bg-info' },
  warning: { bar: 'border-l-warning bg-warning/5', badge: 'bg-warning' },
  maintenance: { bar: 'border-l-primary bg-primary/5', badge: 'bg-primary' },
  critical: { bar: 'border-l-destructive bg-destructive/5', badge: 'bg-destructive' },
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
  const style = TYPE_STYLE[active.type];

  return (
    <div className={`flex items-center gap-3 border-l-4 border-b border-border/60 px-3.5 sm:px-5 py-2.5 shadow-sm animate-fade-in-up ${style.bar}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white ${style.badge}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <p className="flex-1 min-w-0 text-[13px] sm:text-sm font-medium text-foreground leading-snug break-words">
        {active.message}
      </p>
      <button
        type="button"
        onClick={() => { sessionStorage.setItem(DISMISS_KEY, dismissKeyForMessage); setDismissedKey(dismissKeyForMessage); }}
        className="shrink-0 h-8 w-8 min-h-0 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
