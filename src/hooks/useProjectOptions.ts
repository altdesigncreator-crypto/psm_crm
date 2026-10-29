import { useManagedList, type ManagedListConfig } from '@/hooks/useManagedList';

/** Fallback only — the live list is public.projects (Settings → Projects).
 * Matches that table's initial seed. */
const FALLBACK_CONDO = [
  'Dagon Landmark Residence', 'Perfect Signature Residence', 'Ba Htoo Gyi Condo', 'The Century Condo',
  'Aung Zay Ya City', 'Aye Chan Thar Yar Condo', "Lilie's Apartment", 'Einzali Residence', 'Emerald Bay',
  'Aung Chanthar Condo', 'MTP Condo', '65K Residence', 'GRC Condo', 'Royal Theikdi Condo',
  'Pinlon Village Residence', 'My Condo Residence', 'ERC Condo', 'KER Condo', 'Topaz Condo (Bahan)',
  'Residence 18', 'Mahar Swe Condo', 'Yankin Condo',
];
const FALLBACK_HOUSE_LAND = ['North Dagon', 'Orchard', 'Shwe Padauk Avenue', 'South Dagon', 'Mayangone', 'Hlaing Tharyar'];

const PROJECTS: ManagedListConfig = {
  table: 'projects',
  reorderFn: 'reorder_projects',
  cacheKey: 'project-options',
  fallback: { condo: FALLBACK_CONDO, house_land: FALLBACK_HOUSE_LAND },
};

/** The projects offered as a Preferred project, per branch and category. */
export function useProjectOptions(branch?: string | null) {
  return useManagedList(PROJECTS, branch);
}
