import React from 'react';
import { Wrench } from 'lucide-react';
import type { MaintenanceSettings } from '@/types';

/** Full-screen, blocking takeover shown for every visitor while
 * public.maintenance_settings.is_enabled is true — see useMaintenanceStatus
 * and App.tsx. Title/message/image are all edited at /system-banner-admin,
 * the one route this gate never covers. */
export default function MaintenancePage({ settings }: { settings: MaintenanceSettings | null }) {
  const title = settings?.title || 'System Under Maintenance';
  const message = settings?.message || "We'll be back shortly. Thank you for your patience.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
      <div className="w-full max-w-md animate-fade-in-up text-center bg-white rounded-lg shadow-card p-8 sm:p-10 space-y-6">
        {settings?.image_url ? (
          <img src={settings.image_url} alt="" className="h-24 w-auto mx-auto object-contain" draggable={false} />
        ) : (
          <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center mx-auto shadow-card">
            <Wrench className="w-8 h-8 text-white" />
          </div>
        )}

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{message}</p>
        </div>
      </div>
    </div>
  );
}
