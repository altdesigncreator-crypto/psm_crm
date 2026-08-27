import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Search, X, Tag, ExternalLink, SlidersHorizontal, MapPin, Trash2, Flame, Satellite, Map as MapIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useProfiles';
import { useIsMobile } from '@/hooks/use-mobile';
import { isExec } from '@/lib/permissions';
import { fetchStaticPsmParcels, type PsmParcel } from '@/lib/psmMapApi';

// Per the request: fixed starting view, not "fit to all parcels" like
// psm-map's own embed — a specific site/office location the map should
// always open on.
const INITIAL_CENTER: [number, number] = [96.207815, 16.851291]; // [lng, lat]
const INITIAL_ZOOM = 16;

const PARCEL_COLOR = '#0ea5e9';
const PSM_LISTED_COLOR = '#f59e0b';
const PARCELS_SOURCE_ID = 'psm-parcels';
const PARCELS_FILL_LAYER_ID = 'psm-parcels-fill';
const PARCELS_LINE_LAYER_ID = 'psm-parcels-line';
const PARCELS_LABEL_LAYER_ID = 'psm-parcels-label';
const HEATMAP_SOURCE_ID = 'psm-parcels-points';
const HEATMAP_LAYER_ID = 'psm-parcels-heat';
const WARD_COLOR = '#6366f1';
const WARDS_SOURCE_ID = 'psm-ward-boundaries';
const WARD_LABELS_SOURCE_ID = 'psm-ward-labels';
// Below this zoom, individual parcels are too small to read anyway — show
// the dissolved ward border + name instead. At/above it, parcels take
// over. Native GPU-side minzoom/maxzoom on the layers themselves, not a
// state-driven toggle — the same convention psm-map's own main app uses
// (see that project's WardBoundaryLayer.tsx), just at zoom 16 instead of
// their 15, to match this map's initial zoom exactly.
const PARCEL_REVEAL_ZOOM = 16;

const BASE_SATELLITE_LAYER_ID = 'base-satellite';
const BASE_STREET_LAYER_ID = 'base-street';

// Same free/public raster tile sources psm-map's own embed uses — no API
// key required, see that project's src/hooks/useMapStyle.ts. Both sources
// (and both base layers below) are always loaded; only which one is
// visible changes — a plain layout-visibility toggle, same pattern as the
// heat map switch, not a full map.setStyle() swap that would tear down
// every custom source/layer added afterward (parcels, wards, heatmap).
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
    street: {
      type: 'raster',
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: BASE_SATELLITE_LAYER_ID, type: 'raster', source: 'satellite' },
    { id: BASE_STREET_LAYER_ID, type: 'raster', source: 'street', layout: { visibility: 'none' } },
  ],
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Any status' },
  { value: 'available', label: 'Available' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'sold', label: 'Sold' },
];

const PSM_LISTED_OPTIONS = [
  { value: 'all', label: 'Any listing' },
  { value: 'listed', label: 'PSM Listed only' },
  { value: 'unlisted', label: 'Not listed' },
];

/** A CRM-owned map annotation — independent of psm-map's parcel data, see
 * database/crm.sql section 17. */
interface MapPinRow {
  id: string;
  lat: number;
  lng: number;
  description: string;
  created_by: string;
  created_at: string;
}

function parcelsToGeoJSON(parcels: PsmParcel[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: parcels.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: p.geojson,
      properties: { id: p.id, houseNumber: p.house_number, isListed: !!p.psm_property_url },
    })),
  };
}

/** Simple vertex-average centroid — not area-weighted, but these are small
 * near-convex quads, so it's a fine approximation for a display-only
 * heatmap point. Heatmap layers need Point geometry; parcels are Polygons. */
function polygonCentroid(polygon: GeoJSON.Polygon): [number, number] {
  const ring = polygon.coordinates[0];
  let sumLng = 0, sumLat = 0;
  for (const [lng, lat] of ring) { sumLng += lng; sumLat += lat; }
  return [sumLng / ring.length, sumLat / ring.length];
}

function parcelsToPointsGeoJSON(parcels: PsmParcel[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: parcels.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: polygonCentroid(p.geojson) },
      properties: {},
    })),
  };
}

/** Andrew's monotone chain convex hull — ported from psm-map's own
 * src/lib/geo.ts, used the same way it is there: there's no separate ward
 * boundary geometry anywhere (wards are just a label on each parcel), so a
 * ward's "border" is derived by hulling every parcel vertex that shares its
 * ward number. */
function convexHull(points: [number, number][]): [number, number][] {
  const unique = Array.from(new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values())
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (unique.length < 3) return unique;

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const buildHalf = (pts: [number, number][]) => {
    const hull: [number, number][] = [];
    for (const p of pts) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull;
  };

  const lower = buildHalf(unique);
  const upper = buildHalf([...unique].reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

interface WardBoundary {
  wardNumber: string;
  wardName: string | null;
  hull: GeoJSON.Polygon;
  center: [number, number];
}

function computeWardBoundaries(parcels: PsmParcel[]): WardBoundary[] {
  const pointsByWard = new Map<string, [number, number][]>();
  const nameByWard = new Map<string, string | null>();
  for (const p of parcels) {
    if (!p.ward_number) continue;
    const points = pointsByWard.get(p.ward_number) ?? [];
    for (const ring of p.geojson.coordinates) points.push(...(ring as [number, number][]));
    pointsByWard.set(p.ward_number, points);
    if (!nameByWard.has(p.ward_number)) nameByWard.set(p.ward_number, p.ward_name);
  }

  const boundaries: WardBoundary[] = [];
  for (const [wardNumber, points] of pointsByWard) {
    const hullRing = convexHull(points);
    // A hull needs 3+ distinct points to form a real shape — a ward with
    // only one or two parcels' worth of coordinates can't dissolve into
    // anything meaningfully different, so it's skipped rather than drawn
    // as a degenerate sliver.
    if (hullRing.length < 3) continue;

    let sumLng = 0, sumLat = 0;
    for (const [lng, lat] of hullRing) { sumLng += lng; sumLat += lat; }
    boundaries.push({
      wardNumber,
      wardName: nameByWard.get(wardNumber) ?? null,
      hull: { type: 'Polygon', coordinates: [[...hullRing, hullRing[0]]] },
      center: [sumLng / hullRing.length, sumLat / hullRing.length],
    });
  }
  return boundaries;
}

function wardBoundariesToGeoJSON(boundaries: WardBoundary[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: boundaries.map((b) => ({
      type: 'Feature',
      id: b.wardNumber,
      geometry: b.hull,
      properties: { label: b.wardName && b.wardName !== b.wardNumber ? `${b.wardNumber} — ${b.wardName}` : b.wardNumber },
    })),
  };
}

function wardLabelsToGeoJSON(boundaries: WardBoundary[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: boundaries.map((b) => ({
      type: 'Feature',
      id: b.wardNumber,
      geometry: { type: 'Point', coordinates: b.center },
      properties: { label: b.wardName && b.wardName !== b.wardNumber ? `${b.wardNumber} — ${b.wardName}` : b.wardNumber },
    })),
  };
}

function boundsOf(parcels: PsmParcel[]): maplibregl.LngLatBoundsLike | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const p of parcels) {
    for (const ring of p.geojson.coordinates) {
      for (const [lng, lat] of ring) {
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
    }
  }
  if (!Number.isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

function buildPinElement(active: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '30px';
  el.style.height = '30px';
  el.style.cursor = 'pointer';
  el.innerHTML = `
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z" fill="${active ? '#dc2626' : '#0463CA'}" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="9.5" r="2.5" fill="white"/>
    </svg>`;
  return el;
}

export default function PsmMapCanvas() {
  const { user, role } = useAuth();
  const { nameOf } = useProfiles();
  const isMobile = useIsMobile();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  // The full snapshot loaded once from the static export — filtering below
  // is a client-side derivation of this, not a re-fetch.
  const [parcels, setParcels] = useState<PsmParcel[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [wardFilter, setWardFilter] = useState('all');
  const [houseNumber, setHouseNumber] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [psmListedFilter, setPsmListedFilter] = useState('all');
  const [heatMapMode, setHeatMapMode] = useState(false);
  const [basemap, setBasemap] = useState<'satellite' | 'street'>('satellite');

  // One toggle drives both layouts: a floating card on desktop, a bottom
  // sheet on mobile — collapsed by default so the map isn't obstructed
  // until the user actually wants to filter.
  const [filterOpen, setFilterOpen] = useState(false);

  // Only updated when Search/Clear is actually pressed — matches the old
  // "type, then submit" interaction instead of the view jumping around
  // mid-keystroke, even though filtering itself is now instant.
  const [appliedFilters, setAppliedFilters] = useState({ ward: 'all', houseNumber: '', status: 'all', psmListed: 'all' });

  const [selectedParcel, setSelectedParcel] = useState<PsmParcel | null>(null);

  // Pins — the CRM's own location annotations, stored in this app's own
  // database (see database/crm.sql section 17), not psm-map's.
  const [pins, setPins] = useState<MapPinRow[]>([]);
  const [pinMode, setPinMode] = useState(false);
  const [pendingPinCoords, setPendingPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pinDescription, setPinDescription] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [selectedPin, setSelectedPin] = useState<MapPinRow | null>(null);
  const [deletingPin, setDeletingPin] = useState(false);

  useEffect(() => {
    // Fetching the static export on mount — synchronization with a system
    // outside React's own state, not a derivation of it.
    let active = true;
    setLoading(true);
    setError(null);
    fetchStaticPsmParcels()
      .then(({ parcels: data, lastUpdated: updated }) => {
        if (!active) return;
        setParcels(data);
        setLastUpdated(updated);
      })
      .catch((err: any) => {
        if (active) setError(err?.message || 'Could not load parcels.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  // Pins live in the CRM's own database — loaded once, then kept live so a
  // pin dropped by one staff member appears on everyone else's already-open
  // map without a refresh.
  useEffect(() => {
    let active = true;
    supabase.from('map_pins').select('*').order('created_at', { ascending: false }).then(({ data, error: err }) => {
      if (!active) return;
      if (err) { toast.error('Could not load map pins.'); return; }
      setPins((data || []) as MapPinRow[]);
    });

    const channel = supabase
      .channel('map-pins')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'map_pins' }, (payload) => {
        const row = payload.new as MapPinRow;
        setPins((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev]));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'map_pins' }, (payload) => {
        const oldId = (payload.old as { id: string }).id;
        setPins((prev) => prev.filter((p) => p.id !== oldId));
      })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  // Distinct wards found in the loaded data, for the Ward select — sourced
  // from the full set (not the filtered one) so every ward stays pickable
  // no matter what's currently filtered.
  const wardOptions = useMemo(() => {
    const seen = new Map<string, string | null>();
    parcels.forEach((p) => { if (p.ward_number && !seen.has(p.ward_number)) seen.set(p.ward_number, p.ward_name); });
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [parcels]);

  const filteredParcels = useMemo(() => {
    const { ward, houseNumber: house, status, psmListed } = appliedFilters;
    const houseNeedle = house.trim().toLowerCase();
    if (ward === 'all' && !houseNeedle && status === 'all' && psmListed === 'all') return parcels;
    return parcels.filter((p) => {
      if (ward !== 'all' && p.ward_number !== ward) return false;
      if (houseNeedle && !p.house_number.toLowerCase().includes(houseNeedle)) return false;
      if (status !== 'all' && p.detail.status !== status) return false;
      if (psmListed === 'listed' && !p.psm_property_url) return false;
      if (psmListed === 'unlisted' && p.psm_property_url) return false;
      return true;
    });
  }, [parcels, appliedFilters]);

  // Ward "borders" — there's no separate ward geometry anywhere (a ward is
  // just a label on each parcel), so a boundary is derived by hulling every
  // vertex of parcels sharing a ward number. Follows the same filtered set
  // the parcel shapes do, so selecting one ward shows just that one border.
  const wardBoundaries = useMemo(() => computeWardBoundaries(filteredParcels), [filteredParcels]);

  // Map init — runs once. This component itself is only ever mounted once
  // per session (see PsmMapFrame), so there's no remount to guard against.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      // Disabling the auto-added default so it can be explicitly placed
      // at bottom-right below, alongside the zoom control.
      attributionControl: false,
    });
    // Added in this order so the zoom +/- stacks directly above the ⓘ
    // attribution icon, both in the bottom-right corner.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;

    map.on('load', () => {
      // Added before the parcel layers so borders/labels sit underneath —
      // context, not competing with the parcel shapes on top of them.
      map.addSource(WARDS_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'psm-ward-fill',
        type: 'fill',
        source: WARDS_SOURCE_ID,
        maxzoom: PARCEL_REVEAL_ZOOM,
        paint: { 'fill-color': WARD_COLOR, 'fill-opacity': 0.06 },
      });
      map.addLayer({
        id: 'psm-ward-line',
        type: 'line',
        source: WARDS_SOURCE_ID,
        maxzoom: PARCEL_REVEAL_ZOOM,
        paint: { 'line-color': WARD_COLOR, 'line-width': 2, 'line-dasharray': [2, 1] },
      });
      map.addSource(WARD_LABELS_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'psm-ward-label',
        type: 'symbol',
        source: WARD_LABELS_SOURCE_ID,
        maxzoom: PARCEL_REVEAL_ZOOM,
        layout: { 'text-field': ['get', 'label'], 'text-size': 15, 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': false },
        paint: { 'text-color': '#ffffff', 'text-halo-color': WARD_COLOR, 'text-halo-width': 1.5 },
      });

      map.addSource(PARCELS_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: PARCELS_FILL_LAYER_ID,
        type: 'fill',
        source: PARCELS_SOURCE_ID,
        minzoom: PARCEL_REVEAL_ZOOM,
        paint: { 'fill-color': ['case', ['get', 'isListed'], PSM_LISTED_COLOR, PARCEL_COLOR], 'fill-opacity': 0.25 },
      });
      map.addLayer({
        id: PARCELS_LINE_LAYER_ID,
        type: 'line',
        source: PARCELS_SOURCE_ID,
        minzoom: PARCEL_REVEAL_ZOOM,
        paint: { 'line-color': ['case', ['get', 'isListed'], PSM_LISTED_COLOR, PARCEL_COLOR], 'line-width': ['case', ['get', 'isListed'], 3, 2] },
      });
      map.addLayer({
        id: PARCELS_LABEL_LAYER_ID,
        type: 'symbol',
        source: PARCELS_SOURCE_ID,
        minzoom: PARCEL_REVEAL_ZOOM,
        layout: { 'text-field': ['get', 'houseNumber'], 'text-size': 13, 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': false, 'text-optional': true },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.2 },
      });

      // Heatmap view — an alternative visualization of the same filtered
      // set, toggled on/off rather than shown alongside the shapes above.
      // Needs Point geometry, hence the separate centroid-derived source.
      map.addSource(HEATMAP_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: HEATMAP_LAYER_ID,
        type: 'heatmap',
        source: HEATMAP_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 16, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 16, 24],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, '#60a5fa',
            0.4, '#34d399',
            0.6, '#facc15',
            0.8, '#fb923c',
            1, '#dc2626',
          ],
          'heatmap-opacity': 0.75,
        },
      });

      map.on('mouseenter', PARCELS_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', PARCELS_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });

      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Click handling registered separately so it always sees the latest
  // `filteredParcels` without having to tear down and recreate the map.
  // Searches the filtered set, not the full one — that's what's actually
  // rendered/clickable on the map at any given moment. Suppressed while
  // pin-drop mode or heat map mode is active (parcels aren't clickable
  // shapes in heat map view).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (pinMode || heatMapMode) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const found = id ? filteredParcels.find((p) => p.id === id) ?? null : null;
      setSelectedParcel(found);
    };
    map.on('click', PARCELS_FILL_LAYER_ID, onClick);
    return () => { map.off('click', PARCELS_FILL_LAYER_ID, onClick); };
  }, [mapReady, filteredParcels, pinMode, heatMapMode]);

  // General map click — only acts while pin-drop mode is on, dropping a
  // pending pin wherever was clicked (parcel or not) and prompting for a
  // description before it's actually saved.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!pinMode) return;
      setPendingPinCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on('click', onMapClick);
    map.getCanvas().style.cursor = pinMode ? 'crosshair' : '';
    return () => { map.off('click', onMapClick); };
  }, [mapReady, pinMode]);

  // Toggle between the shape layers and the heatmap layer — mutually
  // exclusive views of the same filtered data, not shown together.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const shapesVisibility = heatMapMode ? 'none' : 'visible';
    map.setLayoutProperty(PARCELS_FILL_LAYER_ID, 'visibility', shapesVisibility);
    map.setLayoutProperty(PARCELS_LINE_LAYER_ID, 'visibility', shapesVisibility);
    map.setLayoutProperty(PARCELS_LABEL_LAYER_ID, 'visibility', shapesVisibility);
    map.setLayoutProperty(HEATMAP_LAYER_ID, 'visibility', heatMapMode ? 'visible' : 'none');
  }, [heatMapMode, mapReady]);

  // Basemap switch — same layout-visibility toggle pattern, swapping which
  // of the two always-loaded base raster layers is shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setLayoutProperty(BASE_SATELLITE_LAYER_ID, 'visibility', basemap === 'satellite' ? 'visible' : 'none');
    map.setLayoutProperty(BASE_STREET_LAYER_ID, 'visibility', basemap === 'street' ? 'visible' : 'none');
  }, [basemap, mapReady]);

  // Push the filtered set into the shape source, the heatmap's point
  // source, and the ward boundary/label sources whenever the data or the
  // applied filters change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource(PARCELS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(parcelsToGeoJSON(filteredParcels));
    (map.getSource(HEATMAP_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(parcelsToPointsGeoJSON(filteredParcels));
    (map.getSource(WARDS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(wardBoundariesToGeoJSON(wardBoundaries));
    (map.getSource(WARD_LABELS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(wardLabelsToGeoJSON(wardBoundaries));
  }, [filteredParcels, wardBoundaries, mapReady]);

  // Sync pin markers with the `pins` state — add/remove DOM markers rather
  // than a GeoJSON layer, simple and plenty fast for a hand-placed-pin count.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const existing = markersRef.current;
    const currentIds = new Set(pins.map((p) => p.id));

    for (const [id, marker] of existing) {
      if (!currentIds.has(id)) { marker.remove(); existing.delete(id); }
    }
    for (const pin of pins) {
      if (existing.has(pin.id)) continue;
      const marker = new maplibregl.Marker({ element: buildPinElement(false), anchor: 'bottom' })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      marker.getElement().addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedPin(pin);
      });
      existing.set(pin.id, marker);
    }
  }, [pins, mapReady]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedFilters({ ward: wardFilter, houseNumber, status: statusFilter, psmListed: psmListedFilter });
    setFilterOpen(false);
  };

  const handleClear = () => {
    setWardFilter('all');
    setHouseNumber('');
    setStatusFilter('all');
    setPsmListedFilter('all');
    setAppliedFilters({ ward: 'all', houseNumber: '', status: 'all', psmListed: 'all' });
  };

  const hasActiveFilters = wardFilter !== 'all' || !!houseNumber || statusFilter !== 'all' || psmListedFilter !== 'all';
  const activeFilterCount = [wardFilter !== 'all', !!houseNumber, statusFilter !== 'all', psmListedFilter !== 'all'].filter(Boolean).length;

  const handleLocateResults = () => {
    const map = mapRef.current;
    if (!map || filteredParcels.length === 0) return;
    const bounds = boundsOf(filteredParcels);
    if (bounds) map.fitBounds(bounds, { padding: 60, duration: 400, maxZoom: 18 });
    setFilterOpen(false);
  };

  const togglePinMode = () => {
    setPinMode((prev) => {
      const next = !prev;
      if (next) toast.info('Click anywhere on the map to drop a pin.');
      return next;
    });
    setPendingPinCoords(null);
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !pendingPinCoords || !pinDescription.trim()) return;
    setSavingPin(true);
    try {
      const { data, error: err } = await supabase
        .from('map_pins')
        .insert({ lat: pendingPinCoords.lat, lng: pendingPinCoords.lng, description: pinDescription.trim(), created_by: user.id })
        .select()
        .single();
      if (err) throw err;
      const row = data as MapPinRow;
      setPins((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev]));
      toast.success('Pin added.');
      setPendingPinCoords(null);
      setPinDescription('');
      setPinMode(false);
    } catch (err: any) {
      toast.error(err?.message || 'Could not save the pin.');
    } finally {
      setSavingPin(false);
    }
  };

  const canManagePin = (pin: MapPinRow) => !!user && (pin.created_by === user.id || isExec(role));

  const handleDeletePin = async (pin: MapPinRow) => {
    setDeletingPin(true);
    try {
      const { error: err } = await supabase.from('map_pins').delete().eq('id', pin.id);
      if (err) throw err;
      setPins((prev) => prev.filter((p) => p.id !== pin.id));
      setSelectedPin(null);
      toast.success('Pin removed.');
    } catch (err: any) {
      toast.error(err?.message || 'Could not remove the pin.');
    } finally {
      setDeletingPin(false);
    }
  };

  const filterFieldsContent = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Ward</Label>
        <Select value={wardFilter} onValueChange={setWardFilter}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">All wards</SelectItem>
            {wardOptions.map(([num, name]) => (
              <SelectItem key={num} value={num}>{num}{name && name !== num ? ` — ${name}` : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">House #</Label>
        <Input value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} placeholder="e.g. 31" className="h-11" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Status</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">PSM Listing</Label>
        <Select value={psmListedFilter} onValueChange={setPsmListedFilter}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PSM_LISTED_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <Label htmlFor="heatmap-toggle" className="text-sm font-medium flex items-center gap-2 cursor-pointer">
          <Flame className="w-4 h-4 text-orange-500" /> Heat map view
        </Label>
        <Switch id="heatmap-toggle" checked={heatMapMode} onCheckedChange={setHeatMapMode} />
      </div>

      {filteredParcels.length > 0 && (
        <Button type="button" variant="ghost" size="sm" className="w-full justify-center" onClick={handleLocateResults}>
          Fit map to {filteredParcels.length} result{filteredParcels.length === 1 ? '' : 's'}
        </Button>
      )}

      <div className="flex gap-2 pt-1">
        {hasActiveFilters && (
          <Button type="button" variant="outline" className="flex-1 h-11 gap-1.5" onClick={handleClear}>
            <X className="w-4 h-4" /> Clear
          </Button>
        )}
        <Button type="submit" className="flex-1 h-11 gap-1.5">
          <Search className="w-4 h-4" /> Search
        </Button>
      </div>
    </>
  );

  return (
    <div className="relative h-full w-full">
      {/* MapLibre's default bottom-right control margin, raised further
          per request — lifts the zoom +/- and ⓘ attribution stack off the
          bottom edge (10px, then another 20px on top of that = 30px). */}
      <style>{`.maplibregl-ctrl-bottom-right { margin-bottom: 30px; }`}</style>
      <div ref={containerRef} className="h-full w-full" />

      {/* Filters + Pin toggles side by side — a flex row instead of each
          independently positioned, so they sit beside each other correctly
          no matter how wide the "Filters" label makes the first button. */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        {/* Collapsed by default so the map isn't obstructed until filters
            are actually wanted. */}
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          aria-label={filterOpen ? 'Hide filters' : 'Show filters'}
          aria-pressed={filterOpen}
          className={`h-11 px-4 rounded-xl backdrop-blur-sm border shadow-elevated flex items-center gap-2 active:scale-95 transition-transform ${
            filterOpen ? 'bg-primary text-primary-foreground border-primary' : 'bg-card/95 border-border text-foreground'
          }`}
        >
          <SlidersHorizontal className="w-[18px] h-[18px]" />
          <span className="hidden sm:inline text-sm font-medium">Filters</span>
          {activeFilterCount > 0 && (
            <span className={`flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
              filterOpen ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground'
            }`}>
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Pin-drop toggle — same button style as Filters. Turns red/active
            while armed. */}
        <button
          type="button"
          onClick={togglePinMode}
          aria-label={pinMode ? 'Cancel pin placement' : 'Drop a pin'}
          aria-pressed={pinMode}
          className={`h-11 px-4 rounded-xl backdrop-blur-sm border shadow-elevated flex items-center gap-2 active:scale-95 transition-transform ${
            pinMode ? 'bg-destructive text-white border-destructive' : 'bg-card/95 border-border text-foreground'
          }`}
        >
          <MapPin className="w-[18px] h-[18px]" />
          <span className="hidden sm:inline text-sm font-medium">{pinMode ? 'Cancel' : 'Pin'}</span>
        </button>

        {/* Satellite/Street basemap toggle — same button style as Filters
            and Pin, standalone on the map rather than buried in the filter
            dropdown. Shows the current mode; tap to switch to the other. */}
        <button
          type="button"
          onClick={() => setBasemap((prev) => (prev === 'satellite' ? 'street' : 'satellite'))}
          aria-label={basemap === 'satellite' ? 'Switch to street view' : 'Switch to satellite view'}
          className="h-11 px-4 rounded-xl backdrop-blur-sm border shadow-elevated flex items-center gap-2 active:scale-95 transition-transform bg-card/95 border-border text-foreground"
        >
          {basemap === 'satellite' ? <Satellite className="w-[18px] h-[18px]" /> : <MapIcon className="w-[18px] h-[18px]" />}
          <span className="hidden sm:inline text-sm font-medium">{basemap === 'satellite' ? 'Satellite' : 'Street'}</span>
        </button>
      </div>

      {/* Desktop: floating card, shown/hidden in place. */}
      {filterOpen && (
        <form
          onSubmit={handleSearch}
          className="hidden md:block absolute top-[4.25rem] left-3 z-10 w-80 rounded-2xl border border-border bg-card/95 backdrop-blur-sm shadow-elevated p-4 space-y-3.5 max-h-[calc(100%-5.5rem)] overflow-y-auto"
        >
          <div className="flex items-center justify-between pb-1">
            <h3 className="text-sm font-semibold text-foreground">Search &amp; Filter</h3>
            <button type="button" onClick={() => setFilterOpen(false)} aria-label="Close filters" className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          {filterFieldsContent}
        </form>
      )}

      {/* Mobile: bottom sheet, same toggle state — gated on isMobile too,
          not just md:hidden on the content, because Radix's Dialog/Sheet
          renders a full-screen overlay as soon as `open` is true regardless
          of what CSS hides inside it. Without this gate, opening "Filters"
          on desktop dropped a black bg-black/80 backdrop (z-50, above the
          floating card's z-10) over the whole page with an invisible sheet
          panel behind it — exactly the "goes black, can't click anything"
          bug. */}
      <Sheet open={filterOpen && isMobile} onOpenChange={setFilterOpen}>
        <SheetContent side="bottom" className="md:hidden rounded-t-2xl border-t border-border px-5 pt-6 pb-8 max-h-[85dvh] overflow-y-auto">
          <SheetHeader className="p-0 mb-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="w-4 h-4" /> Search &amp; Filter
            </SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSearch} className="space-y-3.5">
            {filterFieldsContent}
          </form>
        </SheetContent>
      </Sheet>

      {loading && (
        <div className="absolute top-3 right-3 z-10 rounded-lg bg-card/95 backdrop-blur-sm border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
          Loading parcels…
        </div>
      )}

      {/* This is a static snapshot, not a live query — surfacing when it
          was generated so staleness is visible rather than assumed away. */}
      {!loading && lastUpdated && (
        <div className="absolute top-3 right-3 z-10 rounded-lg bg-card/95 backdrop-blur-sm border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm">
          Data as of {lastUpdated.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}

      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-md rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-4 py-2.5 text-sm text-center shadow-elevated">
          {error}
        </div>
      )}

      <Dialog open={!!selectedParcel} onOpenChange={(open) => { if (!open) setSelectedParcel(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          {selectedParcel && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  House {selectedParcel.house_number}
                  {selectedParcel.psm_property_url && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20">
                      <Tag className="w-2.5 h-2.5" /> PSM Listed
                    </span>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {selectedParcel.ward_number && (
                  <p className="text-sm text-muted-foreground">Ward {selectedParcel.ward_number} — {selectedParcel.ward_name}</p>
                )}
                <dl className="space-y-1.5">
                  {Object.entries(selectedParcel.detail).filter(([, v]) => v).map(([key, value]) => (
                    <div key={key} className="flex justify-between text-sm gap-4">
                      <dt className="text-muted-foreground capitalize shrink-0">{key}</dt>
                      <dd className="text-foreground font-medium text-right break-words">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
                {selectedParcel.psm_property_url && (
                  <a href={selectedParcel.psm_property_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" /> View listing
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* New pin — description prompt shown right after a pin-mode click. */}
      <Dialog open={!!pendingPinCoords} onOpenChange={(open) => { if (!open) setPendingPinCoords(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MapPin className="w-4 h-4" /> New pin</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSavePin} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <textarea
                value={pinDescription} onChange={(e) => setPinDescription(e.target.value)} rows={3} autoFocus required
                placeholder="What's here?"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => { setPendingPinCoords(null); setPinDescription(''); }} disabled={savingPin}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingPin || !pinDescription.trim()}>{savingPin ? 'Saving…' : 'Save pin'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* View/remove an existing pin. */}
      <Dialog open={!!selectedPin} onOpenChange={(open) => { if (!open) setSelectedPin(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          {selectedPin && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Pin</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">{selectedPin.description}</p>
                <p className="text-xs text-muted-foreground">
                  {nameOf(selectedPin.created_by)} · {new Date(selectedPin.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                {canManagePin(selectedPin) && (
                  <div className="flex justify-end pt-1">
                    <Button
                      size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => handleDeletePin(selectedPin)} disabled={deletingPin}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> {deletingPin ? 'Removing…' : 'Remove pin'}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
