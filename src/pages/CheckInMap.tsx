import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/contexts/TranslationContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MapPin,
  Search,
  Navigation,
  Filter,
  User,
  Calendar,
  Footprints,
  X,
  Thermometer,
} from 'lucide-react';

interface CheckInRecord {
  id: string;
  agentName: string;
  department?: string;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  checkInTime?: Timestamp;
  level?: string;
}

export default function CheckInMap() {
  const { t } = useTranslation();
  const [checkins, setCheckins] = useState<CheckInRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [selectedCheckin, setSelectedCheckin] = useState<CheckInRecord | null>(null);
  const [mapSrc, setMapSrc] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'checkins'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          agentName: (raw.agentName as string) || '',
          department: (raw.department as string) || '',
          latitude: raw.latitude != null ? Number(raw.latitude) : undefined,
          longitude: raw.longitude != null ? Number(raw.longitude) : undefined,
          locationName: (raw.locationName as string) || '',
          checkInTime: raw.checkInTime as Timestamp | undefined,
          level: (raw.level as string) || '',
        };
      });
      setCheckins(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const agents = useMemo(() => {
    const set = new Set(checkins.map((c) => c.agentName).filter(Boolean));
    return Array.from(set).sort();
  }, [checkins]);

  const filteredCheckins = useMemo(() => {
    return checkins.filter((c) => {
      const matchesSearch =
        !search ||
        c.agentName.toLowerCase().includes(search.toLowerCase()) ||
        (c.locationName || '').toLowerCase().includes(search.toLowerCase());
      const matchesAgent = agentFilter === 'all' || c.agentName === agentFilter;
      const matchesLevel = levelFilter === 'all' || c.level === levelFilter;
      return matchesSearch && matchesAgent && matchesLevel;
    });
  }, [checkins, search, agentFilter, levelFilter]);

  const checkinsWithGPS = useMemo(
    () => filteredCheckins.filter((c) => c.latitude != null && c.longitude != null),
    [filteredCheckins]
  );

  // Heatmap-style: group by lat/lng rounded to 3 decimals for density
  const heatmapClusters = useMemo(() => {
    const clusters: Record<string, { lat: number; lng: number; count: number; agents: Set<string> }> = {};
    checkinsWithGPS.forEach((c) => {
      const key = `${(c.latitude!).toFixed(3)},${(c.longitude!).toFixed(3)}`;
      if (!clusters[key]) {
        clusters[key] = { lat: c.latitude!, lng: c.longitude!, count: 0, agents: new Set() };
      }
      clusters[key].count += 1;
      clusters[key].agents.add(c.agentName);
    });
    return Object.values(clusters).sort((a, b) => b.count - a.count);
  }, [checkinsWithGPS]);

  useEffect(() => {
    if (selectedCheckin && selectedCheckin.latitude && selectedCheckin.longitude) {
      setMapSrc(
        `https://www.google.com/maps/embed/v1/place?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&q=${selectedCheckin.latitude},${selectedCheckin.longitude}&language=en&region=cn&zoom=15`
      );
    } else if (heatmapClusters.length > 0) {
      const first = heatmapClusters[0];
      setMapSrc(
        `https://www.google.com/maps/embed/v1/view?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&center=${first.lat},${first.lng}&zoom=13&language=en&region=cn`
      );
    } else {
      setMapSrc(
        `https://www.google.com/maps/embed/v1/view?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&center=16.8661,96.1951&zoom=12&language=en&region=cn`
      );
    }
  }, [selectedCheckin, heatmapClusters]);

  const levelColor = (level?: string) => {
    switch (level) {
      case 'A': return 'bg-success/10 text-success border-success/20';
      case 'B': return 'bg-warning/10 text-warning border-warning/20';
      case 'C': return 'bg-info/10 text-info border-info/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const densityColor = (count: number) => {
    if (count >= 5) return 'bg-destructive/80';
    if (count >= 3) return 'bg-warning/80';
    if (count >= 2) return 'bg-info/80';
    return 'bg-success/60';
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-5 h-[calc(100dvh-64px)] animate-fade-in-up">
      {/* Sidebar */}
      <div className="w-full md:w-80 lg:w-96 flex flex-col gap-3 shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug flex items-center gap-2">
            <Thermometer className="w-6 h-6 text-primary" />
            Check-In Heatmap
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('common.total')} {filteredCheckins.length} · GPS {checkinsWithGPS.length} · Clusters {heatmapClusters.length}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-10 text-xs flex-1">
                <SelectValue placeholder={t('common.agent')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="h-10 text-xs flex-1">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="A">A</SelectItem>
                <SelectItem value="B">B</SelectItem>
                <SelectItem value="C">C</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Density summary */}
        {heatmapClusters.length > 0 && (
          <Card className="shadow-card rounded-xl border-0 shrink-0">
            <CardContent className="p-3">
              <p className="text-xs font-semibold text-foreground mb-2">Density Clusters</p>
              <div className="flex flex-wrap gap-2">
                {heatmapClusters.slice(0, 8).map((cluster, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setMapSrc(
                        `https://www.google.com/maps/embed/v1/view?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&center=${cluster.lat},${cluster.lng}&zoom=15&language=en&region=cn`
                      );
                      setSelectedCheckin(null);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium text-white ${densityColor(cluster.count)} transition-transform active:scale-95`}
                  >
                    <MapPin className="w-3 h-3" />
                    {cluster.count}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Check-in List */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredCheckins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Footprints className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">{t('common.noData')}</p>
            </div>
          ) : (
            filteredCheckins.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCheckin(c)}
                className={`w-full text-left p-3 rounded-xl border transition-all active:scale-[0.99] ${
                  selectedCheckin?.id === c.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:border-primary/30 hover:bg-primary/5'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{c.agentName || '—'}</p>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      <span>{c.checkInTime?.toDate ? c.checkInTime.toDate().toLocaleDateString('en-GB') : '—'}</span>
                    </div>
                  </div>
                  {c.level && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${levelColor(c.level)}`}>
                      {c.level}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {c.locationName || '—'}
                  </span>
                  {c.latitude != null ? (
                    <span className="flex items-center gap-1 text-success">
                      <Navigation className="w-3 h-3" />
                      GPS
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground/60">
                      <MapPin className="w-3 h-3" />
                      No GPS
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {selectedCheckin && (
          <Card className="shadow-card rounded-xl border-0 shrink-0">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-bold text-foreground">{selectedCheckin.agentName}</p>
                    {selectedCheckin.level && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${levelColor(selectedCheckin.level)}`}>
                        Level {selectedCheckin.level}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {selectedCheckin.locationName || '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {selectedCheckin.checkInTime?.toDate ? selectedCheckin.checkInTime.toDate().toLocaleString('en-GB') : '—'}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedCheckin(null)} className="shrink-0 p-1 rounded-md hover:bg-muted transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-border bg-card">
          {mapSrc ? (
            <iframe
              title="Check-In Map"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              referrerPolicy="no-referrer-when-downgrade"
              src={mapSrc}
              allowFullScreen
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <MapPin className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">Select a check-in to view on map</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
