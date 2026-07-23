import React, { useRef, useState, useEffect } from 'react';
import { supabase } from '@/db/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { getDepartmentLabel } from '@/lib/permissions';
import { processCapturedImage } from '@/lib/cameraUtils';
import { watermarkFromFile } from '@/lib/watermark';
import {
  Camera, MapPin, CheckCircle2, Loader2, RotateCcw, Navigation, History, Globe, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CheckIn as CheckInRecord } from '@/types';

export default function CheckIn() {
  const { user, department } = useAuth();
  const { t } = useTranslation();
  usePageHeader(t('checkin.title'), t('checkin.subtitle'));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  const [history, setHistory] = useState<CheckInRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyMapOpen, setHistoryMapOpen] = useState(false);
  const [historyMapCoords, setHistoryMapCoords] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('error'); return; }
    setGpsStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); setGpsStatus('ok'); },
      () => { setGpsStatus('error'); toast.error('GPS permission is required.'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    (async () => {
      const { data } = await supabase.from('check_ins').select('*').eq('employee_id', user.id).order('check_in_time', { ascending: false }).limit(20);
      if (!active) return;
      setHistory((data || []) as CheckInRecord[]);
      const today = new Date().toISOString().split('T')[0];
      setAlreadyCheckedIn((data || []).some((h) => h.check_in_date === today));
      setHistoryLoading(false);
    })();
    return () => { active = false; };
  }, [user?.id, success]);

  const handleNativeCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { previewUrl, correctedFile } = await processCapturedImage(file);
      setPhotoFile(correctedFile);
      setPhoto(previewUrl);
      setSuccess(false);
      toast.success('Photo captured.');
    } catch {
      setPhotoFile(file);
      setPhoto(URL.createObjectURL(file));
    }
  };

  const handleRetake = () => {
    setPhoto(null);
    setPhotoFile(null);
    setSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!description.trim()) { toast.error('Enter your current location / activity.'); return; }
    if (gpsStatus !== 'ok' && lat == null) { toast.error('Still capturing GPS — please wait.'); return; }
    if (!user?.id) return;

    setSubmitting(true);
    try {
      let photoUrl: string | null = null;
      if (photoFile) {
        const { file: watermarkedFile } = await watermarkFromFile(photoFile, {
          name: user.name || user.email,
          department: department ? getDepartmentLabel(department) : null,
          location: description.trim(),
          latitude: lat,
          longitude: lng,
        });
        const path = `${user.id}/${Date.now()}.jpg`;
        const { error: uploadErr } = await supabase.storage.from('checkin-photos').upload(path, watermarkedFile);
        if (uploadErr) throw uploadErr;
        photoUrl = supabase.storage.from('checkin-photos').getPublicUrl(path).data.publicUrl;
      }

      // The DB trigger (compute_checkin_status) flips status to 'late' when
      // the time is past the department's window — read the row back so we
      // can tell the user whether approval is now required.
      const { data: inserted, error } = await supabase.from('check_ins').insert({
        employee_id: user.id,
        department_code: department || 'house',
        latitude: lat,
        longitude: lng,
        photo_url: photoUrl,
        notes: description.trim(),
        status: 'on_time',
      }).select('*').single();
      if (error) {
        if (error.code === '23505') throw new Error('You have already checked in today.');
        throw error;
      }

      setSuccess(true);
      if (inserted?.is_late) {
        toast.warning('You checked in late — it is now waiting for Super Admin approval.');
      } else {
        toast.success('Check-in submitted.');
      }
      setTimeout(() => { setDescription(''); setPhoto(null); setPhotoFile(null); setSuccess(false); }, 2500);
    } catch (err: any) {
      toast.error(err.message || 'Check-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const gpsLabel = { idle: 'Waiting for GPS permission', loading: 'Getting GPS…', ok: 'GPS captured', error: 'Could not get GPS' }[gpsStatus];

  return (
    <div className="max-w-lg mx-auto space-y-5 animate-fade-in-up px-1 pb-6">
      <div className="md:hidden">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground leading-snug">{t('checkin.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('checkin.subtitle')}</p>
      </div>

      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${gpsStatus === 'ok' ? 'bg-success/10 text-success' : gpsStatus === 'loading' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}>
        <Navigation className="w-3.5 h-3.5" /> <span>{gpsLabel}</span>
      </div>

      {alreadyCheckedIn && !success && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium bg-info/10 text-info">
          <CheckCircle2 className="w-3.5 h-3.5" /> You've already checked in today.
        </div>
      )}

      {!photo && (
        <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 snap-x snap-mandatory pb-1 md:hidden">
          <button type="button" onClick={() => cameraInputRef.current?.click()} className="snap-start shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full bg-success/10 text-success text-xs font-medium active:bg-success/20 active:scale-95 transition-all">
            <Camera className="w-3.5 h-3.5" /> Take Photo
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="snap-start shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20 active:scale-95 transition-all">
            <Upload className="w-3.5 h-3.5" /> Upload Photo
          </button>
        </div>
      )}

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Camera className="w-4 h-4 text-primary" /></div>
            Report Field Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Current location / activity</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Showing a unit to a customer at Dagon Landmark" className="min-h-[80px] resize-none text-sm" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Photo (optional)</label>
            {/* No `capture` attribute — this opens the normal file/gallery
                picker so staff can upload an already-taken photo, not just
                a freshly-shot one. */}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleNativeCapture} />
            {/* `capture` opens the phone's native camera app directly. The
                photo goes through the same watermark pipeline as uploads
                (see handleSubmit). */}
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleNativeCapture} />

            {!photo && (
              <div className="hidden md:grid md:grid-cols-2 gap-3">
                <button type="button" onClick={() => cameraInputRef.current?.click()} className="h-48 md:h-52 rounded-xl border-2 border-dashed border-border bg-muted/40 hover:bg-muted active:bg-muted/80 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-3 group">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center group-active:scale-95 transition-transform"><Camera className="w-7 h-7 text-primary" /></div>
                  <span className="text-sm font-semibold text-foreground">Take Photo</span>
                  <span className="text-[11px] text-muted-foreground -mt-2">Opens your phone camera</span>
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="h-48 md:h-52 rounded-xl border-2 border-dashed border-border bg-muted/40 hover:bg-muted active:bg-muted/80 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-3 group">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center group-active:scale-95 transition-transform"><Upload className="w-7 h-7 text-primary" /></div>
                  <span className="text-sm font-semibold text-foreground">Upload Photo</span>
                  <span className="text-[11px] text-muted-foreground -mt-2">Choose from your device</span>
                </button>
              </div>
            )}

            {photo && (
              <div className="relative w-full rounded-lg overflow-hidden border border-border">
                <img src={photo} alt="Captured" className="w-full h-48 md:h-56 object-cover" />
                <button type="button" onClick={handleRetake} className="absolute top-2 right-2 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 active:bg-black/90 transition-colors"><RotateCcw className="w-5 h-5" /></button>
                {gpsStatus === 'ok' && lat != null && lng != null && (
                  <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1"><MapPin className="w-3 h-3" />{lat.toFixed(5)}, {lng.toFixed(5)}</div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {gpsStatus === 'ok' && lat != null && lng != null && (
              <button type="button" onClick={() => setMapOpen(true)} className="h-12 flex items-center gap-2 px-4 rounded-xl border border-primary/30 text-primary bg-primary/5 active:bg-primary/10 active:scale-[0.98] transition-all w-full md:w-fit justify-center md:justify-start text-sm font-medium">
                <MapPin className="w-4 h-4" /> View location
              </button>
            )}
            {success && (
              <div className="flex items-center gap-2 text-success bg-success/10 rounded-lg px-3 py-2"><CheckCircle2 className="w-4 h-4" /><span className="text-sm font-medium">Check-in submitted</span></div>
            )}
            <Button
              onClick={handleSubmit}
              disabled={submitting || !description.trim() || success || (gpsStatus !== 'ok' && lat == null)}
              className="h-14 w-full gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 hover:shadow-card-hover text-base active:scale-[0.98]"
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {submitting ? 'Submitting…' : 'Submit Check-in'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><History className="w-4 h-4 text-primary" /></div>
            Check-in History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          {historyLoading ? (
            <div className="flex items-center justify-center py-6"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground"><History className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm font-medium">No check-ins yet</p></div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Last {history.length}</p>
                <button
                  type="button"
                  onClick={() => {
                    const coords = history.filter((h) => h.latitude && h.longitude).map((h) => ({ lat: h.latitude!, lng: h.longitude!, label: h.notes || '' }));
                    if (coords.length === 0) { toast.info('No GPS-tagged records.'); return; }
                    setHistoryMapCoords(coords);
                    setHistoryMapOpen(true);
                  }}
                  className="text-xs font-medium text-primary flex items-center gap-1 px-2 py-1 rounded-md bg-primary/5 active:bg-primary/10 transition-colors"
                >
                  <Globe className="w-3.5 h-3.5" /> View route
                </button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:shadow-sm transition-all active:scale-[0.99] min-h-[52px]">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><MapPin className="w-4 h-4 text-primary" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{h.notes || '—'}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">{h.check_in_date}</span>
                        {h.is_late ? (
                          h.approved_by ? (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20">Late · Approved</span>
                          ) : (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20">Late · Pending approval</span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">· {h.status}</span>
                        )}
                      </div>
                    </div>
                    {h.latitude && h.longitude && (
                      <button type="button" onClick={() => { setHistoryMapCoords([{ lat: h.latitude!, lng: h.longitude!, label: h.notes || '' }]); setHistoryMapOpen(true); }} className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center active:bg-muted/80 transition-colors shrink-0">
                        <Globe className="w-4 h-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2"><DialogTitle>Check-in Location</DialogTitle></DialogHeader>
          {lat != null && lng != null && (
            <div className="w-full h-72 md:h-80">
              <iframe title="Check-In Location" width="100%" height="100%" style={{ border: 0 }} referrerPolicy="no-referrer-when-downgrade" src={`https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`} allowFullScreen />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={historyMapOpen} onOpenChange={setHistoryMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2"><DialogTitle>Check-in History Route</DialogTitle></DialogHeader>
          {historyMapCoords.length > 0 && (
            <div className="w-full h-72 md:h-80">
              <iframe title="Check-In History Route" width="100%" height="100%" style={{ border: 0 }} referrerPolicy="no-referrer-when-downgrade" src={`https://maps.google.com/maps?q=${historyMapCoords[0].lat},${historyMapCoords[0].lng}&z=15&output=embed`} allowFullScreen />
            </div>
          )}
          {historyMapCoords.length > 1 && (
            <div className="px-6 pb-4 pt-2"><p className="text-xs text-muted-foreground">{historyMapCoords.length} recorded locations</p></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
