import { CONDO_SOURCES, HOUSE_LAND_SOURCES } from '@/types';
import { useManagedList, type ListItem, type ManagedListConfig } from '@/hooks/useManagedList';

export { CATEGORY_LABEL_KEYS, ENQUIRY_CATEGORIES, normalizeListName as normalizeSourceName } from '@/hooks/useManagedList';
export type EnquirySource = ListItem;

const SOURCES: ManagedListConfig = {
  table: 'enquiry_sources',
  reorderFn: 'reorder_enquiry_sources',
  cacheKey: 'enquiry-sources',
  fallback: { condo: CONDO_SOURCES, house_land: HOUSE_LAND_SOURCES },
};

/** Lead and enquiry sources — one list per branch (Settings → Lead
 * sources), read by every source picker and filter on the Enquiries and
 * Leads pages. Pass the branch the form is for; omit it for filters. */
export function useEnquirySources(branch?: string | null) {
  return useManagedList(SOURCES, branch);
}
