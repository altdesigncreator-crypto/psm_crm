/**
 * Data source for the CRM's PSM Map tab.
 *
 * Reads come from a static GeoJSON export hosted alongside the CRM itself
 * (public/data/psm-map-parcels.geojson) instead of psm-map's live API — a
 * CDN-cached static file beats a ~34s, ~50MB streamed Edge Function
 * response on every single page load, at the cost of the map showing a
 * snapshot rather than live data (see the file's own Last-Modified header,
 * surfaced in the UI, for how stale that snapshot is). Regenerate that file
 * and redeploy whenever the underlying parcel data changes meaningfully.
 *
 * Parcels here are read-only, deliberately — editing one used to write
 * through psm-map's live "Map Frame" API, but the save would just vanish
 * from this CRM's own (static-snapshot) map view again until the next
 * export, which made "did that actually save?" a reasonable thing to
 * wonder. Map annotations (src/components/PsmMapCanvas.tsx's pins) replace
 * that need instead — they're stored in the CRM's own database (see
 * database/crm.sql section 17), so what you create here is what you see
 * here, live, no export/redeploy step involved.
 */
const STATIC_PARCELS_URL = '/data/psm-map-parcels.geojson';

export interface PsmParcelDetail {
  owner?: string;
  price?: string;
  size?: string;
  status?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface PsmParcel {
  id: string;
  ward_number: string | null;
  ward_name: string | null;
  house_number: string;
  detail: PsmParcelDetail;
  psm_property_url: string | null;
  geojson: GeoJSON.Polygon;
}

interface StaticParcelFeature {
  type: 'Feature';
  id: string;
  geometry: GeoJSON.Polygon;
  properties: {
    house_number: string;
    ward_number: string | null;
    ward_name: string | null;
    psm_property_url: string | null;
    owner?: string;
    price?: string;
    size?: string;
    status?: string;
    notes?: string;
  };
}

export interface StaticParcelsResult {
  parcels: PsmParcel[];
  /** From the response's Last-Modified header — when this export was
   * generated, not when it was fetched. Null if the server didn't send one
   * (e.g. local dev without a real static-file server). */
  lastUpdated: Date | null;
}

export async function fetchStaticPsmParcels(): Promise<StaticParcelsResult> {
  const res = await fetch(STATIC_PARCELS_URL);
  if (!res.ok) throw new Error(`Could not load parcel data (${res.status}).`);

  const lastModifiedHeader = res.headers.get('Last-Modified');
  const lastUpdated = lastModifiedHeader ? new Date(lastModifiedHeader) : null;

  const geojson = (await res.json()) as { features: StaticParcelFeature[] };
  const parcels: PsmParcel[] = geojson.features.map((f) => ({
    id: f.id,
    ward_number: f.properties.ward_number,
    ward_name: f.properties.ward_name,
    house_number: f.properties.house_number,
    psm_property_url: f.properties.psm_property_url,
    geojson: f.geometry,
    detail: {
      owner: f.properties.owner,
      price: f.properties.price,
      size: f.properties.size,
      status: f.properties.status,
      notes: f.properties.notes,
    },
  }));

  return { parcels, lastUpdated: lastUpdated && !Number.isNaN(lastUpdated.getTime()) ? lastUpdated : null };
}
