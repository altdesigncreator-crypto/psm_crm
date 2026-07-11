import React, { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, Clock, CalendarDays, User, Footprints, Eye, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProfiles } from '@/hooks/useProfiles';
import type { CheckIn } from '@/types';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function CheckInFeed() {
  const { nameOf } = useProfiles();
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<CheckIn | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase.from('check_ins').select('*').eq('check_in_date', today).order('check_in_time', { ascending: false });
      if (active) {
        setCheckins((data || []) as CheckIn[]);
        setLoading(false);
      }
    };
    load();
    const channel = supabase
      .channel('checkin-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins' }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const openMap = (lat: number, lng: number) => { setSelectedCoords({ lat, lng }); setMapOpen(true); };
  const openLightbox = (record: CheckIn) => { setLightboxPhoto(record); setLightboxOpen(true); };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (checkins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <Footprints className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">No check-ins recorded today.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {checkins.map((c) => (
          <Card key={c.id} className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 overflow-hidden flex flex-col h-full group">
            {c.photo_url ? (
              <div className="aspect-[4/3] w-full overflow-hidden bg-muted cursor-pointer relative" onClick={() => openLightbox(c)}>
                <img src={c.photo_url} alt={`${nameOf(c.employee_id)} check-in`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-white/90 text-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center shadow-lg">
                    <Eye className="w-5 h-5" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="aspect-[4/3] w-full bg-muted flex items-center justify-center text-muted-foreground">
                <Footprints className="w-8 h-8 opacity-40" />
              </div>
            )}

            <CardContent className="p-4 flex flex-col flex-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="w-3 h-3 text-primary" />
                </div>
                <span className="text-xs font-semibold text-foreground truncate">{nameOf(c.employee_id)}</span>
              </div>

              <p className="text-sm text-foreground leading-snug line-clamp-2 flex-1">{c.notes || 'Field check-in'}</p>

              <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{formatShortDate(c.check_in_time)}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(c.check_in_time)}</span>
              </div>

              {c.latitude && c.longitude && (
                <button
                  type="button"
                  onClick={() => openMap(c.latitude!, c.longitude!)}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-[#0463CA] hover:bg-[#0352a8] rounded-lg py-2 transition-colors shadow-sm"
                >
                  <MapPin className="w-3 h-3" /> View location
                </button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2"><DialogTitle>Check-in Location</DialogTitle></DialogHeader>
          {selectedCoords && (
            <div className="w-full h-72 md:h-80">
              <iframe
                title="Check-In Location" width="100%" height="100%" style={{ border: 0 }}
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://maps.google.com/maps?q=${selectedCoords.lat},${selectedCoords.lng}&z=15&output=embed`}
                allowFullScreen
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl p-0 overflow-hidden bg-black border-0">
          <button type="button" onClick={() => setLightboxOpen(false)} className="absolute top-3 right-3 z-50 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors">
            <X className="w-5 h-5" />
          </button>
          {lightboxPhoto?.photo_url && (
            <div className="w-full">
              <img src={lightboxPhoto.photo_url} alt="Check-in full resolution" className="w-full max-h-[80vh] object-contain" />
              <div className="bg-black/80 text-white px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{lightboxPhoto.notes || 'Field check-in'}</p>
                  <p className="text-xs text-white/70 mt-0.5">{nameOf(lightboxPhoto.employee_id)} · {formatTime(lightboxPhoto.check_in_time)}</p>
                </div>
                {lightboxPhoto.latitude && lightboxPhoto.longitude && (
                  <button
                    type="button"
                    onClick={() => { setLightboxOpen(false); openMap(lightboxPhoto.latitude!, lightboxPhoto.longitude!); }}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-md px-3 py-1.5 transition-colors"
                  >
                    <MapPin className="w-3 h-3" /> Location
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
