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

/** Lead and enquiry sources — one list (Settings → Lead sources), read by
 * every source picker and filter on the Enquiries and Leads pages. */
export function useEnquirySources() {
  return useManagedList(SOURCES);
}
