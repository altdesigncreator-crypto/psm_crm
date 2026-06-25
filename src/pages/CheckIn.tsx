import React, { useRef, useState, useEffect, useCallback } from 'react';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, Timestamp, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { getDepartment } from '@/lib/roleUtils';
import { submitCheckIn } from '@/lib/backgroundSync';
import { uploadFileWithFallback } from '@/lib/offlineStorageQueue';
import {
  getCameraStream,
  captureFromStream,
  dataURLtoFile,
  processCapturedImage,
} from '@/lib/cameraUtils';
import { watermarkFromFile } from '@/lib/watermark';
import VoiceRecorder from '@/components/VoiceRecorder';
import VoiceNotesList from '@/components/VoiceNotesList';
import {
  Camera,
  MapPin,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Smartphone,
  X,
  Navigation,
  Mic,
  RefreshCw,
  History,
  Globe,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type CameraMode = 'none' | 'native' | 'webrtc';

export default function CheckIn() {
  const { user, role: userRole } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>('none');
  const [webrtcReady, setWebrtcReady] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');

  // Location History
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyMapOpen, setHistoryMapOpen] = useState(false);
  const [historyMapCoords, setHistoryMapCoords] = useState<{ lat: number; lng: number; label: string }[]>([]);

  // Proactive GPS capture
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      return;
    }
    setGpsStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setGpsStatus('ok');
      },
      () => {
        setGpsStatus('error');
        toast.error('GPS ခွင့်ပြုချက်လိုအပ်ပါသည်');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  // Fetch location history
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'checkins'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => {
          const docData = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            project: (docData.project as string) || '',
            latitude: (docData.latitude as number) || 0,
            longitude: (docData.longitude as number) || 0,
            timestamp: docData.timestamp as Timestamp,
            photoURL: (docData.photoURL as string) || '',
          };
        });
        setHistory(data);
        setHistoryLoading(false);
      },
      () => {
        setHistoryLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  // Start WebRTC camera with given facing mode
  const startWebRTCCamera = useCallback(async (facing: 'environment' | 'user') => {
    try {
      // Stop any existing stream first
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await getCameraStream(facing);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setWebrtcReady(true);
      }
    } catch {
      toast.error('Camera ကိုရယူ၍မရပါ');
      setCameraMode('none');
    }
  }, []);

  // Stop WebRTC camera
  const stopWebRTCCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setWebrtcReady(false);
  }, []);

  useEffect(() => {
    if (cameraMode === 'webrtc') {
      startWebRTCCamera(cameraFacing);
    }
    return () => stopWebRTCCamera();
  }, [cameraMode, cameraFacing, startWebRTCCamera, stopWebRTCCamera]);

  const handleSwitchCamera = () => {
    const next = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(next);
    if (cameraMode === 'webrtc') {
      setWebrtcReady(false);
      startWebRTCCamera(next);
    }
  };

  const handleNativeCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { previewUrl, correctedFile } = await processCapturedImage(file);
      setPhotoFile(correctedFile);
      setPhoto(previewUrl);
      setSuccess(false);
      toast.success('ဓာတ်ပုံ ရိုက်ကူးပြီးပါပြီ');
    } catch {
      setPhotoFile(file);
      setPhoto(URL.createObjectURL(file));
    }
  };

  const handleWebRTCCapture = () => {
    const video = videoRef.current;
    if (!video || !webrtcReady) return;
    const dataUrl = captureFromStream(video, video.videoWidth, video.videoHeight);
    if (!dataUrl) {
      toast.error('ဓာတ်ပုံ ရိုက်ကူးရာတွင် အမှားဖြစ်သွားပါသည်');
      return;
    }
    const file = dataURLtoFile(dataUrl, `checkin_${Date.now()}.jpg`);
    if (!file) {
      toast.error('ဓာတ်ပုံ ဖိုင်ပြုလုပ်ရာတွင် အမှားဖြစ်သွားပါသည်');
      return;
    }
    setPhotoFile(file);
    setPhoto(dataUrl);
    setCameraMode('none');
    setSuccess(false);
    toast.success('ဓာတ်ပုံ ရိုက်ကူးပြီးပါပြီ');
  };

  const handleRetake = () => {
    setPhoto(null);
    setPhotoFile(null);
    setSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!description.trim() || !photoFile) {
      toast.error('ရောက်ရှိနေသော နေရာ/အကြောင်းအရာနှင့် ဓာတ်ပုံကို ထည့်သွင်းပါ');
      return;
    }
    if (gpsStatus !== 'ok' && lat == null) {
      toast.error('GPS ကိုရယူနေသည်... ခဏစောင့်ပါ');
      return;
    }

    if (!user?.uid) {
      toast.error('အကောင့်ဝင်ရောက်ရန် လိုအပ်ပါသည်');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Apply watermark
      toast.info('ဓာတ်ပုံတွင် Watermark ထည့်နေသည်...');
      const { file: watermarkedFile } = await watermarkFromFile(
        photoFile,
        user?.email || 'Unknown'
      );

      // 2. Upload to Firebase Storage with offline fallback
      const fileName = `checkins/${user.uid}/${Date.now()}.jpg`;
      let photoURL: string;
      try {
        photoURL = await uploadFileWithFallback(
          'checkin_photo',
          'checkins',
          {
            userId: user.uid,
            ownerId: user.uid,
            agentName: user?.email || 'Unknown',
            project: description.trim(),
            latitude: lat ?? 0,
            longitude: lng ?? 0,
            department: getDepartment(userRole),
          },
          'photoURL',
          fileName,
          watermarkedFile
        );
      } catch (err: any) {
        if (err.message === 'OFFLINE_QUEUED') {
          toast.info('Check-in photo ကို offline queue တွင် သိမ်းဆည်းထားပါသည်။ အင်တာနက် ပြန်လာလျှင် auto-upload လုပ်ပေးပါမည်။');
          setSuccess(true);
          setPhotoFile(null);
          setDescription('');
          setSubmitting(false);
          return;
        }
        throw err;
      }

      // 3. Save to Firestore with userId (uses submitCheckIn helper for offline queue support)
      await submitCheckIn({
        userId: user.uid,
        ownerId: user.uid,
        agentName: user?.email || 'Unknown',
        project: description.trim(),
        photoURL,
        latitude: lat ?? 0,
        longitude: lng ?? 0,
        department: getDepartment(userRole),
      });

      // 4. Write unified notification for Boss/Admin real-time feed (best-effort, non-blocking)
      try {
        await addDoc(collection(db, 'notifications'), {
          title: 'ဆိုက်ရောက်ကြောင်း တင်ပြခြင်း',
          message: description.trim(),
          type: 'check-in',
          agentName: user?.email || 'Unknown',
          timestamp: Timestamp.now(),
          isRead: false,
        });
      } catch (notifErr) {
        // Notification write failure should not fail the check-in
        // eslint-disable-next-line no-console
        console.warn('Check-in notification write failed:', notifErr);
      }

      setSuccess(true);
      toast.success('တင်ပြခြင်း အောင်မြင်ပါသည်');

      setTimeout(() => {
        setDescription('');
        setPhoto(null);
        setPhotoFile(null);
        setSuccess(false);
      }, 2500);
    } catch (err: any) {
      const msg = err?.message || 'တင်ပြရာတွင် အမှားတစ်ခု ဖြစ်သွားပါသည်';
      toast.error(`တင်ပြရန် မအောင်မြင်ပါ — ${msg}`);
      // eslint-disable-next-line no-console
      console.error('Check-in upload error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const gpsLabel = {
    idle: 'GPS ခွင့်ပြုရန် လိုအပ်သည်',
    loading: 'GPS ရယူနေသည်...',
    ok: 'GPS ရယူပြီးပါပြီ',
    error: 'GPS ရယူ၍မရပါ',
  }[gpsStatus];

  return (
    <div className="max-w-lg mx-auto space-y-5 animate-fade-in-up px-1 pb-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold text-foreground leading-snug">
          ဆိုက်ရောက်ကြောင်း တင်ပြရန်
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Live Site Check-In</p>
      </div>

      {/* GPS Status Bar */}
      <div
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
          gpsStatus === 'ok'
            ? 'bg-success/10 text-success'
            : gpsStatus === 'loading'
              ? 'bg-warning/10 text-warning'
              : 'bg-destructive/10 text-destructive'
        }`}
      >
        <Navigation className="w-3.5 h-3.5" />
        <span>{gpsLabel}</span>
      </div>

      {/* Mobile Camera Mode Quick Pills */}
      {!photo && cameraMode === 'none' && (
        <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 snap-x snap-mandatory pb-1 md:hidden">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="snap-start shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20 active:scale-95 transition-all"
          >
            <Camera className="w-3.5 h-3.5" />
            ဖုန်းကင်မရာ
          </button>
          <button
            type="button"
            onClick={() => setCameraMode('webrtc')}
            className="snap-start shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full bg-success/10 text-success text-xs font-medium active:bg-success/20 active:scale-95 transition-all"
          >
            <Smartphone className="w-3.5 h-3.5" />
            Live Camera
          </button>
        </div>
      )}


      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Camera className="w-4 h-4 text-primary" />
            </div>
            မြေပြင် လှုပ်ရှားမှု တင်ပြရန်
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              ရောက်ရှိနေသော နေရာ / အကြောင်းအရာ
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ဥပမာ - Dagon Landmark တွင် ဖောက်သည်အား အခန်းပြနေပါသည်"
              className="min-h-[80px] resize-none text-sm"
            />
          </div>

          {/* Camera Capture */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">ဓာတ်ပုံရိုက်ရန်</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleNativeCapture}
            />

            {/* Camera grid — hidden on mobile when quick pills are shown */}
            {!photo && cameraMode === 'none' && (
              <div className="hidden md:grid md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-48 md:h-52 rounded-xl border-2 border-dashed border-border bg-muted/40 hover:bg-muted active:bg-muted/80 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-3 group"
                >
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center group-active:scale-95 transition-transform">
                    <Camera className="w-7 h-7 text-primary" />
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    ဖုန်းကင်မရာ
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Camera ဖြင့်ရိုက်ရန်
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setCameraMode('webrtc')}
                  className="h-48 md:h-52 rounded-xl border-2 border-dashed border-border bg-muted/40 hover:bg-muted active:bg-muted/80 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-3 group"
                >
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center group-active:scale-95 transition-transform">
                    <Smartphone className="w-7 h-7 text-primary" />
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    Live Camera
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    ဘရောဇာမှ တိုက်ရိုက်ရိုက်ရန်
                  </span>
                </button>
              </div>
            )}

            {/* WebRTC Live Camera */}
            {cameraMode === 'webrtc' && (
              <div className="relative w-full rounded-lg overflow-hidden border border-border bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-52 md:h-60 object-cover"
                  playsInline
                  muted
                />
                {/* Camera facing indicator */}
                <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-1 rounded-full flex items-center gap-1">
                  <Camera className="w-3 h-3" />
                  {cameraFacing === 'environment' ? 'ပေါ်ပြန်ကင်မရာ' : 'ရှေ့ကင်မရာ'}
                </div>
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setCameraMode('none')}
                    className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 active:bg-white/40 transition-colors"
                    title="ပိတ်ရန်"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleWebRTCCapture}
                    disabled={!webrtcReady}
                    className="w-16 h-16 rounded-full border-4 border-white bg-primary flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform shadow-lg"
                    title="ရိုက်ရန်"
                  >
                    <Camera className="w-7 h-7 text-white" />
                  </button>
                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    disabled={!webrtcReady}
                    className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 active:bg-white/40 transition-colors disabled:opacity-40"
                    title="ကင်မရာပြောင်းရန်"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Photo Preview */}
            {photo && cameraMode === 'none' && (
              <div className="relative w-full rounded-lg overflow-hidden border border-border">
                <img
                  src={photo}
                  alt="Captured"
                  className="w-full h-48 md:h-56 object-cover"
                />
                <button
                  type="button"
                  onClick={handleRetake}
                  className="absolute top-2 right-2 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 active:bg-black/90 transition-colors"
                  title="ပြန်ရိုက်ရန်"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
                {gpsStatus === 'ok' && lat != null && lng != null && (
                  <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="flex flex-col gap-3">
            {gpsStatus === 'ok' && lat != null && lng != null && (
              <button
                type="button"
                onClick={() => setMapOpen(true)}
                className="h-12 flex items-center gap-2 px-4 rounded-xl border border-primary/30 text-primary bg-primary/5 active:bg-primary/10 active:scale-[0.98] transition-all w-full md:w-fit justify-center md:justify-start text-sm font-medium"
              >
                <MapPin className="w-4 h-4" />
                နေရာကို ကြည့်ရန်
              </button>
            )}

            {success && (
              <div className="flex items-center gap-2 text-success bg-success/10 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">ဆိုက်ရောက်ကြောင်း တင်ပြပြီးပါပြီ</span>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={submitting || !description.trim() || !photoFile || success || (gpsStatus !== 'ok' && lat == null)}
              className="h-14 w-full gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 hover:shadow-card-hover text-base active:scale-[0.98]"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              {submitting ? 'တင်နေသည်...' : 'ဆိုက်ရောက်ကြောင်း တင်ပြရန်'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Voice Recording Card */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mic className="w-4 h-4 text-primary" />
            </div>
            အသံဖြင့် မှတ်တမ်းတင်ရန်
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <VoiceRecorder parentType="checkin" />
          <VoiceNotesList parentType="checkin" />
        </CardContent>
      </Card>

      {/* Location History */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <History className="w-4 h-4 text-primary" />
            </div>
            ဆိုက်ရောက်မှတ်တမ်း
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          {historyLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <History className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">မှတ်တမ်းမရှိသေးပါ</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">နောက်ဆုံး {history.length} ခု</p>
                <button
                  type="button"
                  onClick={() => {
                    const coords = history
                      .filter((h) => h.latitude && h.longitude)
                      .map((h) => ({ lat: h.latitude, lng: h.longitude, label: h.project || '' }));
                    if (coords.length === 0) {
                      toast.info('GPS ကိုအခြေခံသော မှတ်တမ်း မရှိပါ');
                      return;
                    }
                    setHistoryMapCoords(coords);
                    setHistoryMapOpen(true);
                  }}
                  className="text-xs font-medium text-primary flex items-center gap-1 px-2 py-1 rounded-md bg-primary/5 active:bg-primary/10 transition-colors"
                >
                  <Globe className="w-3.5 h-3.5" />
                  လမ်းကြောင်း ကြည့်ရန်
                </button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:shadow-sm transition-all active:scale-[0.99] min-h-[52px]"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <MapPin className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{h.project || '—'}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {h.latitude?.toFixed(5)}, {h.longitude?.toFixed(5)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryMapCoords([{ lat: h.latitude, lng: h.longitude, label: h.project || '' }]);
                        setHistoryMapOpen(true);
                      }}
                      className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center active:bg-muted/80 transition-colors shrink-0"
                    >
                      <Globe className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Map Modal — Current Check-In */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>ဆိုက်ရောက်နေရာ</DialogTitle>
          </DialogHeader>
          {lat != null && lng != null && (
            <div className="w-full h-72 md:h-80">
              <iframe
                title="Check-In Location"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&q=${lat},${lng}&language=en&region=cn`}
                allowFullScreen
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Map Modal — Location History Route */}
      <Dialog open={historyMapOpen} onOpenChange={setHistoryMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>ဆိုက်ရောက်မှတ်တမ်း လမ်းကြောင်း</DialogTitle>
          </DialogHeader>
          {historyMapCoords.length > 0 && (
            <div className="w-full h-72 md:h-80">
              <iframe
                title="Check-In History Route"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&q=${historyMapCoords[0].lat},${historyMapCoords[0].lng}&language=en&region=cn`}
                allowFullScreen
              />
            </div>
          )}
          {historyMapCoords.length > 1 && (
            <div className="px-6 pb-4 pt-2">
              <p className="text-xs text-muted-foreground">
                {historyMapCoords.length} ခု နေရာတွင် ဆိုက်ရောက်ခဲ့ပါသည်
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
