import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, Clock, CalendarDays, User, Footprints, Eye, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { getDepartment, isAdmin } from '@/lib/roleUtils';

interface CheckInRecord {
  id: string;
  agentName: string;
  project: string;
  photoURL: string;
  latitude: number;
  longitude: number;
  timestamp: Timestamp;
  department?: string;
}

function isToday(ts: Timestamp): boolean {
  const d = ts.toDate();
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatTime(ts: Timestamp): string {
  const d = ts.toDate();
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatShortDate(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function CheckInFeed() {
  const { role } = useAuth();
  const userDept = getDepartment(role);
  const isAdminUser = isAdmin(role);

  const [checkins, setCheckins] = useState<CheckInRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<CheckInRecord | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'checkins'),
      where('timestamp', '>=', Timestamp.fromDate(new Date(new Date().setHours(0, 0, 0, 0)))),
      where('timestamp', '<=', Timestamp.fromDate(new Date(new Date().setHours(23, 59, 59, 999))))
    );
    const unsub = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as CheckInRecord))
        .filter((c) => isToday(c.timestamp));
      // Department filter: admin/chairman sees all, others see only their department
      if (!isAdminUser) {
        data = data.filter((c) => !c.department || c.department === userDept);
      }
      data = data.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
      setCheckins(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userDept, isAdminUser]);

  const openMap = (lat: number, lng: number) => {
    setSelectedCoords({ lat, lng });
    setMapOpen(true);
  };

  const openLightbox = (record: CheckInRecord) => {
    setLightboxPhoto(record);
    setLightboxOpen(true);
  };

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
        <p className="text-sm">ယနေ့ဆိုက်ရောက်မှတ်တမ်းမရှိသေးပါ</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {checkins.map((c) => (
          <Card
            key={c.id}
            className="shadow-card hover:shadow-card-hover transition-all duration-300 rounded-xl border-0 overflow-hidden flex flex-col h-full group"
          >
            {/* Photo */}
            <div
              className="aspect-[4/3] w-full overflow-hidden bg-muted cursor-pointer relative"
              onClick={() => openLightbox(c)}
            >
              <img
                src={c.photoURL}
                alt={`${c.agentName} check-in`}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-white/90 text-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center shadow-lg">
                  <Eye className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Info */}
            <CardContent className="p-4 flex flex-col flex-1">
              {/* Agent */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="w-3 h-3 text-primary" />
                </div>
                <span className="text-xs font-semibold text-foreground truncate">{c.agentName}</span>
              </div>

              {/* Description */}
              <p className="text-sm text-foreground leading-snug line-clamp-2 flex-1">{c.project}</p>

              {/* Date/Time */}
              <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />
                  {formatShortDate(c.timestamp)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatTime(c.timestamp)}
                </span>
              </div>

              {/* View Location */}
              <button
                type="button"
                onClick={() => openMap(c.latitude, c.longitude)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-[#0463CA] hover:bg-[#0352a8] rounded-lg py-2 transition-colors shadow-sm"
              >
                <MapPin className="w-3 h-3" />
                တည်နေရာ ကြည့်ရန်
              </button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Map Dialog */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>ဆိုက်ရောက်နေရာ</DialogTitle>
          </DialogHeader>
          {selectedCoords && (
            <div className="w-full h-72 md:h-80">
              <iframe
                title="Check-In Location"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&q=${selectedCoords.lat},${selectedCoords.lng}&language=en&region=cn`}
                allowFullScreen
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl p-0 overflow-hidden bg-black border-0">
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-3 right-3 z-50 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          {lightboxPhoto && (
            <div className="w-full">
              <img
                src={lightboxPhoto.photoURL}
                alt="Check-in full resolution"
                className="w-full max-h-[80vh] object-contain"
              />
              <div className="bg-black/80 text-white px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{lightboxPhoto.project}</p>
                  <p className="text-xs text-white/70 mt-0.5">
                    {lightboxPhoto.agentName} · {formatTime(lightboxPhoto.timestamp)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLightboxOpen(false);
                    openMap(lightboxPhoto.latitude, lightboxPhoto.longitude);
                  }}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-md px-3 py-1.5 transition-colors"
                >
                  <MapPin className="w-3 h-3" />
                  Location
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
