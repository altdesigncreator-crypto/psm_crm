import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin, Clock, CalendarDays, User, ImageOff, Eye, X, Filter, Trash2, LayoutGrid, List, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useProfiles';
import { isExec, getDepartmentLabel } from '@/lib/permissions';
import { useDepartments } from '@/hooks/useDepartments';
import type { CheckIn as CheckInRecord } from '@/types';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function CheckInGallery() {
  const { role } = useAuth();
  const { nameOf } = useProfiles();
  const { departments } = useDepartments();
  const [checkins, setCheckins] = useState<CheckInRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery');
  const [mapOpen, setMapOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<CheckInRecord | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');

  const canDelete = isExec(role);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.from('check_ins').select('*').order('check_in_time', { ascending: false });
      if (!active) return;
      setCheckins((data || []) as CheckInRecord[]);
      setLoading(false);
    };
    load();
    const channel = supabase.channel('checkin-gallery').on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins' }, () => load()).subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const agents = useMemo(() => Array.from(new Set(checkins.map((c) => nameOf(c.employee_id)))).sort(), [checkins, nameOf]);

  const filteredCheckins = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return checkins.filter((c) => {
      const matchesAgent = agentFilter === 'all' || nameOf(c.employee_id) === agentFilter;
      const matchesDept = deptFilter === 'all' || c.department_code === deptFilter;
      let matchesDate = true;
      const cDate = new Date(c.check_in_time);
      if (dateFilter === 'today') matchesDate = cDate >= startOfToday;
      else if (dateFilter === 'week') matchesDate = cDate >= startOfWeek;
      else if (dateFilter === 'month') matchesDate = cDate >= startOfMonth;
      return matchesAgent && matchesDept && matchesDate;
    });
  }, [checkins, agentFilter, deptFilter, dateFilter, nameOf]);

  const openMap = (lat: number, lng: number) => { setSelectedCoords({ lat, lng }); setMapOpen(true); };
  const openLightbox = (record: CheckInRecord, index = 0) => { setLightboxPhoto(record); setLightboxIndex(index); setLightboxOpen(true); };
  const goToPrevPhoto = () => { const i = lightboxIndex > 0 ? lightboxIndex - 1 : filteredCheckins.length - 1; setLightboxIndex(i); setLightboxPhoto(filteredCheckins[i]); };
  const goToNextPhoto = () => { const i = lightboxIndex < filteredCheckins.length - 1 ? lightboxIndex + 1 : 0; setLightboxIndex(i); setLightboxPhoto(filteredCheckins[i]); };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this check-in record?')) return;
    const { error } = await supabase.from('check_ins').delete().eq('id', id);
    if (error) toast.error('Could not delete this record.');
    else toast.success('Deleted.');
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (checkins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-muted-foreground">
        <ImageOff className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No check-ins yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug">Check-in Records</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredCheckins.length} total
            {agentFilter !== 'all' && ` · ${agentFilter}`}
            {deptFilter !== 'all' && ` · ${getDepartmentLabel(deptFilter)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-11 w-32 text-sm"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-11 w-36 text-sm"><SelectValue placeholder="Employee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {agents.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as any)}>
              <SelectTrigger className="h-11 w-28 text-sm"><Calendar className="w-3.5 h-3.5 mr-1" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="month">This month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center border border-border rounded-lg overflow-hidden shrink-0">
            <Button variant={viewMode === 'gallery' ? 'default' : 'ghost'} size="sm" className="h-11 px-3 rounded-none" onClick={() => setViewMode('gallery')}><LayoutGrid className="w-4 h-4" /></Button>
            <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" className="h-11 px-3 rounded-none" onClick={() => setViewMode('list')}><List className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>

      {filteredCheckins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground"><ImageOff className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm font-medium">No records for this filter</p></div>
      ) : viewMode === 'gallery' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {filteredCheckins.map((c, idx) => (
            <Card key={c.id} className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 overflow-hidden flex flex-col h-full">
              <div className="aspect-square w-full overflow-hidden bg-muted cursor-pointer relative group active:scale-[0.98] transition-transform" onClick={() => openLightbox(c, idx)}>
                {c.photo_url ? (
                  <img src={c.photo_url} alt={`${nameOf(c.employee_id)} check-in`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageOff className="w-8 h-8 opacity-40" /></div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 active:bg-black/10 transition-colors duration-300 flex items-center justify-center">
                  <div className="w-11 h-11 rounded-full bg-white/90 text-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center shadow-lg"><Eye className="w-5 h-5" /></div>
                </div>
                {canDelete && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }} className="absolute top-2 right-2 z-10 w-10 h-10 rounded-full bg-white/90 text-destructive flex items-center justify-center hover:bg-destructive hover:text-white active:bg-destructive/80 transition-colors shadow-sm">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <CardContent className="p-3 md:p-5 flex flex-col flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-primary" /></div>
                  <p className="text-sm font-semibold text-foreground truncate">{nameOf(c.employee_id)}</p>
                </div>
                <p className="text-xs md:text-sm text-foreground leading-relaxed line-clamp-2 flex-1">{c.notes || 'Field check-in'}</p>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                  <CalendarDays className="w-3.5 h-3.5" /><Clock className="w-3 h-3" /><span>{formatDateTime(c.check_in_time)}</span>
                </div>
                {c.latitude && c.longitude && (
                  <button type="button" onClick={() => openMap(c.latitude!, c.longitude!)} className="mt-3 w-full flex items-center justify-center gap-2 text-sm font-semibold text-white bg-primary hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98] rounded-xl h-12 transition-all shadow-sm">
                    <MapPin className="w-4 h-4" /> View location
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-xl border-0 shadow-card overflow-hidden">
          <div className="w-full max-w-full overflow-x-auto">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Photo</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Employee</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Department</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Notes</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Date</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredCheckins.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button type="button" onClick={() => openLightbox(c)} className="w-14 h-14 rounded-lg overflow-hidden border border-border bg-muted block active:opacity-80">
                        {c.photo_url ? <img src={c.photo_url} alt={nameOf(c.employee_id)} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center"><ImageOff className="w-4 h-4 text-muted-foreground" /></div>}
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-primary" /></div><span className="font-medium text-foreground">{nameOf(c.employee_id)}</span></div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap"><span className="text-xs font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground border border-border">{getDepartmentLabel(c.department_code)}</span></td>
                    <td className="px-4 py-3 whitespace-nowrap text-foreground">{c.notes || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">{formatDateTime(c.check_in_time)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {c.latitude && c.longitude && (
                          <button type="button" onClick={() => openMap(c.latitude!, c.longitude!)} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-primary/10 active:bg-primary/20 rounded-md px-2.5 py-1.5 transition-colors">
                            <MapPin className="w-3.5 h-3.5" /> <span className="hidden md:inline">Location</span>
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" onClick={() => handleDelete(c.id)} className="flex items-center gap-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 active:bg-destructive/20 rounded-md px-2.5 py-1.5 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" /> <span className="hidden md:inline">Delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2"><DialogTitle>Check-in Location</DialogTitle></DialogHeader>
          {selectedCoords && (
            <div className="w-full h-72 md:h-80">
              <iframe title="Check-In Location" width="100%" height="100%" style={{ border: 0 }} referrerPolicy="no-referrer-when-downgrade" src={`https://maps.google.com/maps?q=${selectedCoords.lat},${selectedCoords.lng}&z=15&output=embed`} allowFullScreen />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl p-0 overflow-hidden bg-black border-0">
          <button type="button" onClick={() => setLightboxOpen(false)} className="absolute top-3 right-3 z-50 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 active:bg-black/90 transition-colors"><X className="w-5 h-5" /></button>
          {filteredCheckins.length > 1 && (
            <>
              <button type="button" onClick={goToPrevPhoto} className="absolute left-3 top-1/2 -translate-y-1/2 z-50 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 active:bg-black/90 transition-colors"><ChevronLeft className="w-5 h-5" /></button>
              <button type="button" onClick={goToNextPhoto} className="absolute right-3 top-1/2 -translate-y-1/2 z-50 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 active:bg-black/90 transition-colors"><ChevronRight className="w-5 h-5" /></button>
            </>
          )}
          {lightboxPhoto && (
            <div className="w-full">
              {lightboxPhoto.photo_url && <img src={lightboxPhoto.photo_url} alt="Check-in full resolution" className="w-full max-h-[80vh] object-contain" />}
              <div className="bg-black/80 text-white px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{lightboxPhoto.notes || 'Field check-in'}</p>
                  <p className="text-xs text-white/70 mt-0.5">{nameOf(lightboxPhoto.employee_id)} · {formatDateTime(lightboxPhoto.check_in_time)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-white/50">{lightboxIndex + 1} / {filteredCheckins.length}</span>
                  {lightboxPhoto.latitude && lightboxPhoto.longitude && (
                    <button type="button" onClick={() => { setLightboxOpen(false); openMap(lightboxPhoto.latitude!, lightboxPhoto.longitude!); }} className="flex items-center gap-1.5 text-xs font-medium text-white/90 hover:text-white bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-lg px-3.5 py-2 transition-colors">
                      <MapPin className="w-3.5 h-3.5" /> Location
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
