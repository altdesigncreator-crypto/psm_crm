import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin, Search, Navigation, Filter, Calendar, Footprints, X, Thermometer } from 'lucide-react';
import { useProfiles } from '@/hooks/useProfiles';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import NameLink from '@/components/NameLink';
import { CHECKIN_STATUSES, type CheckIn as CheckInRecord } from '@/types';

const STATUS_COLOR: Record<string, string> = {
  on_time: 'bg-success/10 text-success border-success/20',
  late: 'bg-warning/10 text-warning border-warning/20',
  absent: 'bg-destructive/10 text-destructive border-destructive/20',
  leave: 'bg-info/10 text-info border-info/20',
  field_work: 'bg-primary/10 text-primary border-primary/20',
};

export default function CheckInMap() {
  const { nameOf } = useProfiles();
  const [checkins, setCheckins] = useState<CheckInRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCheckin, setSelectedCheckin] = useState<CheckInRecord | null>(null);
  const [mapSrc, setMapSrc] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.from('check_ins').select('*').order('check_in_time', { ascending: false });
      if (active) { setCheckins((data || []) as CheckInRecord[]); setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const agents = useMemo(() => Array.from(new Set(checkins.map((c) => nameOf(c.employee_id)))).sort(), [checkins, nameOf]);

  const filteredCheckins = useMemo(() => {
    return checkins.filter((c) => {
      const agentName = nameOf(c.employee_id);
      const matchesSearch = !search || agentName.toLowerCase().includes(search.toLowerCase()) || (c.notes || '').toLowerCase().includes(search.toLowerCase());
      const matchesAgent = agentFilter === 'all' || agentName === agentFilter;
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
      return matchesSearch && matchesAgent && matchesStatus;
    });
  }, [checkins, search, agentFilter, statusFilter, nameOf]);

  const checkinsWithGPS = useMemo(() => filteredCheckins.filter((c) => c.latitude != null && c.longitude != null), [filteredCheckins]);

  const heatmapClusters = useMemo(() => {
    const clusters: Record<string, { lat: number; lng: number; count: number }> = {};
    checkinsWithGPS.forEach((c) => {
      const key = `${c.latitude!.toFixed(3)},${c.longitude!.toFixed(3)}`;
      if (!clusters[key]) clusters[key] = { lat: c.latitude!, lng: c.longitude!, count: 0 };
      clusters[key].count += 1;
    });
    return Object.values(clusters).sort((a, b) => b.count - a.count);
  }, [checkinsWithGPS]);

  useEffect(() => {
    if (selectedCheckin?.latitude && selectedCheckin?.longitude) {
      setMapSrc(`https://maps.google.com/maps?q=${selectedCheckin.latitude},${selectedCheckin.longitude}&z=15&output=embed`);
    } else if (heatmapClusters.length > 0) {
      const first = heatmapClusters[0];
      setMapSrc(`https://maps.google.com/maps?q=${first.lat},${first.lng}&z=13&output=embed`);
    } else {
      setMapSrc(`https://maps.google.com/maps?q=16.8661,96.1951&z=12&output=embed`);
    }
  }, [selectedCheckin, heatmapClusters]);

  const densityColor = (count: number) => {
    if (count >= 5) return 'bg-destructive/80';
    if (count >= 3) return 'bg-warning/80';
    if (count >= 2) return 'bg-info/80';
    return 'bg-success/60';
  };

  usePageHeader('Check-In Map', `Total ${filteredCheckins.length} · GPS ${checkinsWithGPS.length} · Clusters ${heatmapClusters.length}`);

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-5 h-[calc(100dvh-64px)] animate-fade-in-up">
      <div className="w-full md:w-80 lg:w-96 flex flex-col gap-3 shrink-0">
        <div className="md:hidden">
          <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug flex items-center gap-2">
            <Thermometer className="w-6 h-6 text-primary" /> Check-In Map
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Total {filteredCheckins.length} · GPS {checkinsWithGPS.length} · Clusters {heatmapClusters.length}</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full h-11 pl-9 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            {search && (<button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-muted-foreground" /></button>)}
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-10 text-xs flex-1"><SelectValue placeholder="Employee" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{agents.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}</SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 text-xs flex-1"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {CHECKIN_STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {heatmapClusters.length > 0 && (
          <Card className="shadow-card rounded-xl border-0 shrink-0">
            <CardContent className="p-3">
              <p className="text-xs font-semibold text-foreground mb-2">Density Clusters</p>
              <div className="flex flex-wrap gap-2">
                {heatmapClusters.slice(0, 8).map((cluster, idx) => (
                  <button key={idx} type="button" onClick={() => { setMapSrc(`https://maps.google.com/maps?q=${cluster.lat},${cluster.lng}&z=15&output=embed`); setSelectedCheckin(null); }} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium text-white ${densityColor(cluster.count)} transition-transform active:scale-95`}>
                    <MapPin className="w-3 h-3" /> {cluster.count}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : filteredCheckins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground"><Footprints className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm font-medium">No records</p></div>
          ) : (
            filteredCheckins.map((c) => (
              <div key={c.id} role="button" tabIndex={0} onClick={() => setSelectedCheckin(c)} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedCheckin(c); }} className={`w-full text-left p-3 rounded-xl border transition-all active:scale-[0.99] cursor-pointer ${selectedCheckin?.id === c.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/30 hover:bg-primary/5'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <NameLink id={c.employee_id} name={nameOf(c.employee_id)} showAvatar={false} className="text-sm font-semibold" />
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground"><Calendar className="w-3 h-3" /><span className="tabular-nums">{new Date(c.check_in_time).toLocaleDateString('en-GB')}</span></div>
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${STATUS_COLOR[c.status]}`}>{CHECKIN_STATUSES.find((s) => s.value === c.status)?.label}</span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.notes || '—'}</span>
                  {c.latitude != null ? (<span className="flex items-center gap-1 text-success"><Navigation className="w-3 h-3" />GPS</span>) : (<span className="flex items-center gap-1 text-muted-foreground/60"><MapPin className="w-3 h-3" />No GPS</span>)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {selectedCheckin && (
          <Card className="shadow-card rounded-xl border-0 shrink-0">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <NameLink id={selectedCheckin.employee_id} name={nameOf(selectedCheckin.employee_id)} showAvatar={false} className="text-base font-bold" />
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLOR[selectedCheckin.status]}`}>{CHECKIN_STATUSES.find((s) => s.value === selectedCheckin.status)?.label}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{selectedCheckin.notes || '—'}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{new Date(selectedCheckin.check_in_time).toLocaleString('en-GB')}</span>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedCheckin(null)} className="shrink-0 p-1 rounded-md hover:bg-muted transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-border bg-card">
          {mapSrc ? (
            <iframe title="Check-In Map" width="100%" height="100%" style={{ border: 0 }} referrerPolicy="no-referrer-when-downgrade" src={mapSrc} allowFullScreen />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground"><MapPin className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">Select a check-in to view on map</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
