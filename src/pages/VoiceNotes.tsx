import React from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import VoiceRecorder from '@/components/VoiceRecorder';
import VoiceNotesList from '@/components/VoiceNotesList';

export default function VoiceNotes() {
  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in-up px-1 pb-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug">
          အသံမှတ်တမ်းများ
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Voice Notes & Recordings
        </p>
      </div>

      {/* Recorder Card — full width on mobile */}
      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mic className="w-4 h-4 text-primary" />
            </div>
            အသံ မှတ်တမ်းတင်ရန်
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 md:p-6">
          <VoiceRecorder
            onSaved={() => {
              // VoiceNotesList auto-refreshes via onSnapshot
            }}
          />
        </CardContent>
      </Card>

      {/* Voice Notes List */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Volume2 className="w-4 h-4 text-primary" />
            </div>
            မှတ်တမ်းများအရင်း
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <VoiceNotesList />
        </CardContent>
      </Card>
    </div>
  );
}
