import React from 'react';
import { Cog } from 'lucide-react';
import type { MaintenanceSettings } from '@/types';

/** Full-screen, blocking takeover shown for every visitor while
 * public.maintenance_settings.is_enabled is true — see useMaintenanceStatus
 * and App.tsx. Title/message are edited at /system-banner-admin, the one
 * route this gate never covers. The hero visual is a built-in animated gear
 * pair — there's no logo/photo upload for this page. */
export default function MaintenancePage({ settings }: { settings: MaintenanceSettings | null }) {
  const title = settings?.title || 'System Under Maintenance';
  const message = settings?.message || "We'll be back shortly. Thank you for your patience.";

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#F8FAFC] px-4">
      {/* Aurora background — soft, slowly drifting gradient blobs behind the card */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#0463CA]/10 blur-3xl animate-[drift_16s_ease-in-out_infinite]" />
        <div className="absolute -bottom-32 -right-16 w-[28rem] h-[28rem] rounded-full bg-[#D4AF37]/10 blur-3xl animate-[drift_20s_ease-in-out_infinite_reverse]" />
        <div className="absolute top-1/3 right-1/4 w-72 h-72 rounded-full bg-[#0A2540]/5 blur-3xl animate-[drift_24s_ease-in-out_infinite]" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in-up text-center bg-white/80 backdrop-blur-xl rounded-3xl shadow-elevated border border-border/40 p-8 sm:p-10 space-y-7">
        {/* Gear animation — the page's hero visual */}
        <div className="relative w-28 h-28 mx-auto">
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-[#0463CA]/25 to-[#D4AF37]/25 blur-xl animate-pulse" />
          <Cog className="absolute inset-0 w-28 h-28 text-[#0463CA] animate-[spin_6s_linear_infinite]" strokeWidth={1.25} />
          <Cog className="absolute bottom-0 right-0 w-12 h-12 text-[#D4AF37] animate-[spin-reverse_4.5s_linear_infinite]" strokeWidth={1.5} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{message}</p>
        </div>

        <div className="flex items-center justify-center gap-2 pt-1">
          <span className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Working on it</span>
          <span className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0463CA] animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#0463CA] animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#0463CA] animate-bounce" />
          </span>
        </div>
      </div>
    </div>
  );
}
