import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';

/**
 * The visible map is rendered by PsmMapFrame, mounted persistently inside
 * AppLayout so it survives navigating away and back (see that file for
 * why). This route exists only so /psm-map participates normally in
 * routing, the nav's active-state highlighting, and RouteGuard's
 * permission check, same as every other page.
 */
export default function PsmMap() {
  const { t } = useTranslation();
  usePageHeader(t('nav.psmMap'));
  return null;
}
