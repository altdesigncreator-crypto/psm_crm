import React, { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Mic, User, Clock, Volume2, Filter } from 'lucide-react';

interface VoiceNote {
  id: string;
  agentName: string;
  audioUrl: string;
  duration: number;
  timestamp: Timestamp;
  department?: string;
}

interface VoiceNotesListProps {
  parentId?: string;
  parentType?: 'lead' | 'checkin';
}

export default function VoiceNotesList({ parentId, parentType }: VoiceNotesListProps) {
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState('all');

  useEffect(() => {
    let constraints: ReturnType<typeof query>;
    const base = collection(db, 'audio_notes');

    if (parentId && parentType) {
      constraints = query(
        base,
        where('parentId', '==', parentId),
        where('parentType', '==', parentType),
        orderBy('timestamp', 'desc')
      );
    } else if (parentType === 'checkin') {
      constraints = query(base, where('parentType', '==', 'checkin'), orderBy('timestamp', 'desc'));
    } else {
      constraints = query(base, orderBy('timestamp', 'desc'));
    }

    const unsub = onSnapshot(
      constraints,
      (snap) => {
        const data = snap.docs.map((d) => {
          const docData = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            agentName: (docData.agentName as string) || '',
            audioUrl: (docData.audioUrl as string) || '',
            duration: (docData.duration as number) || 0,
            timestamp: docData.timestamp as Timestamp,
            department: (docData.department as string) || undefined,
          } as VoiceNote;
        });
        setNotes(data);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, [parentId, parentType]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const formatDate = (ts: Timestamp) => {
    try {
      return ts.toDate().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const filteredNotes = notes.filter((n) => {
    if (deptFilter === 'all') return true;
    return !n.department || n.department === deptFilter;
  });

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Volume2 className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm font-medium">အသံမှတ်တမ်းမရှိသေးပါ</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="h-12 w-44 text-sm">
            <SelectValue placeholder="ဌာနအားလုံး" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ဌာနအားလုံး</SelectItem>
            <SelectItem value="house">အိမ်ရာ</SelectItem>
            <SelectItem value="condo">ကွန်ဒို</SelectItem>
            <SelectItem value="project">ပရောဂျက်</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filteredNotes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Volume2 className="w-10 h-10 mb-2 opacity-30" />
          <p className="text-sm font-medium">ရွေးချယ်ထားသော ဌာနတွင် အသံမှတ်တမ်းမရှိပါ</p>
        </div>
      )}

      {/* Mobile-optimized voice note cards */}
      <div className="space-y-3">
        {filteredNotes.map((note) => (
          <div
            key={note.id}
            className="rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-card-hover transition-all active:scale-[0.99]"
          >
            {/* Header row */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Mic className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{note.agentName}</p>
                <p className="text-xs text-muted-foreground">{formatDate(note.timestamp)}</p>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs font-medium text-muted-foreground shrink-0">
                <Clock className="w-3 h-3" />
                <span className="tabular-nums">{formatDuration(note.duration)}</span>
              </div>
            </div>

            {/* Audio player */}
            <div className="w-full">
              <audio controls className="w-full h-12 rounded-lg">
                <source src={note.audioUrl} type="audio/webm" />
              </audio>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
