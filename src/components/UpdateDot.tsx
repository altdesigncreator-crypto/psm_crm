import { useAppUpdate } from '@/lib/appUpdate';
import { useTranslation } from '@/contexts/TranslationContext';

/** Small pulsing dot marking the way to Settings while an app update is
 * waiting. Renders nothing otherwise, so it can be dropped next to any
 * Settings entry point. Position it with `className` (it's absolutely
 * positioned by the caller's relative container). */
export default function UpdateDot({ className = '' }: { className?: string }) {
  const { updateAvailable } = useAppUpdate();
  const { t } = useTranslation();
  if (!updateAvailable) return null;
  return (
    <span className={`pointer-events-none flex h-2.5 w-2.5 ${className}`} role="status" aria-label={t('update.availableTitle')}>
      <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card" />
    </span>
  );
}
