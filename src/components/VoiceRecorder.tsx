import React, { useRef, useState, useEffect, useCallback } from 'react';
import { collection, addDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { getDepartment } from '@/lib/roleUtils';
import { uploadFileWithFallback } from '@/lib/offlineStorageQueue';
import { Button } from '@/components/ui/button';
import { Mic, Square, Pause, Play, Send, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface VoiceRecorderProps {
  parentId?: string;
  parentType?: 'lead' | 'checkin';
  onSaved?: () => void;
}

/** Trigger haptic feedback if supported */
function haptic(ms: number = 10) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

/** Animated wave bars component */
function WaveBars({ active }: { active: boolean }) {
  const bars = [0.3, 0.5, 0.8, 1, 0.7, 0.4, 0.6, 0.9, 0.5, 0.3, 0.7, 0.4];
  return (
    <div className="flex items-center justify-center gap-[3px] h-10">
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-destructive origin-bottom"
          style={{
            height: active ? `${h * 100}%` : '20%',
            opacity: active ? 1 : 0.3,
            animation: active ? `wave-bar 0.8s ease-in-out ${i * 0.05}s infinite alternate` : 'none',
            transition: 'height 0.3s ease, opacity 0.3s ease',
          }}
        />
      ))}
    </div>
  );
}

export default function VoiceRecorder({
  parentId,
  parentType,
  onSaved,
}: VoiceRecorderProps) {
  const { user, role: userRole } = useAuth();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<'idle' | 'recording' | 'paused' | 'stopped'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    if (!user?.uid) {
      toast.error('အကောင့်ဝင်ရောက်ရန် လိုအပ်ပါသည်');
      return;
    }
    try {
      haptic(20);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg')
          ? 'audio/ogg'
          : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || 'audio/webm',
        });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setStatus('stopped');
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(1000);
      setStatus('recording');
      setSeconds(0);
      startTimer();
    } catch {
      toast.error('မိုက်ခရိုဖုန်းကို ရယူ၍မရပါ — ခွင့်ပြုချက်ကို စစ်ဆေးပါ');
    }
  };

  const pauseRecording = () => {
    haptic(12);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    setStatus('paused');
    stopTimer();
  };

  const resumeRecording = () => {
    haptic(12);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    setStatus('recording');
    startTimer();
  };

  const stopRecording = () => {
    haptic(20);
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.stop();
    stopTimer();
  };

  const resetRecording = () => {
    haptic(10);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setStatus('idle');
    setSeconds(0);
    chunksRef.current = [];
    mediaRecorderRef.current = null;
  };

  const handleSubmit = async () => {
    haptic(20);
    if (!audioBlob || !user?.uid) return;
    setUploading(true);
    try {
      const fileName = `audio_notes/${user.uid}/${Date.now()}.webm`;
      const payload = {
        userId: user.uid,
        ownerId: user.uid,
        agentName: user.email || 'Unknown',
        duration: seconds,
        parentId: parentId || null,
        parentType: parentType || null,
        department: getDepartment(userRole),
      };

      let audioUrl: string;
      try {
        audioUrl = await uploadFileWithFallback(
          'voice_note',
          'audio_notes',
          payload,
          'audioUrl',
          fileName,
          audioBlob
        );
      } catch (err: any) {
        if (err.message === 'OFFLINE_QUEUED') {
          toast.info('အသံမှတ်တမ်း ကို offline queue တွင် သိမ်းဆည်းထားပါသည်။');
          resetRecording();
          onSaved?.();
          setUploading(false);
          return;
        }
        throw err;
      }

      // Online path: write Firestore doc with the returned URL
      await addDoc(collection(db, 'audio_notes'), {
        ...payload,
        audioUrl,
        timestamp: Timestamp.now(),
      });

      toast.success('အသံမှတ်တမ်း သိမ်းဆည်းပြီးပါပြီ');
      resetRecording();
      onSaved?.();
    } catch (err: any) {
      const msg = err?.message || 'သိမ်းဆည်းရာတွင် အမှားဖြစ်သွားပါသည်';
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    return () => {
      stopTimer();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, [audioUrl, stopTimer]);

  return (
    <div className="space-y-4">
      {/* Status / Timer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === 'recording' && (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
              </span>
              <span className="text-sm font-medium text-destructive">မှတ်တမ်းတင်နေသည်...</span>
            </>
          )}
          {status === 'paused' && (
            <span className="text-sm font-medium text-warning">ခဏရပ်ထားသည်</span>
          )}
          {status === 'stopped' && (
            <span className="text-sm font-medium text-success">မှတ်တမ်းတင်ပြီးပါပြီ</span>
          )}
          {status === 'idle' && (
            <span className="text-sm font-medium text-muted-foreground">အသံမှတ်တမ်းတင်ရန်</span>
          )}
        </div>
        <span className="text-sm font-mono text-muted-foreground tabular-nums">
          {formatTime(seconds)}
        </span>
      </div>

      {/* Wave Animation */}
      {(status === 'recording' || status === 'paused') && (
        <WaveBars active={status === 'recording'} />
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        {status === 'idle' && (
          <Button
            type="button"
            onClick={startRecording}
            className="h-12 w-full gradient-primary hover:gradient-primary-hover text-white font-medium active:scale-[0.98] transition-transform text-sm"
          >
            <Mic className="w-5 h-5 mr-2" />
            အသံမှတ်တမ်းတင်ရန်
          </Button>
        )}

        {(status === 'recording' || status === 'paused') && (
          <div className="flex items-center gap-3 w-full">
            {status === 'recording' ? (
              <Button
                type="button"
                variant="outline"
                onClick={pauseRecording}
                className="h-12 flex-1 active:scale-[0.98] transition-transform text-sm"
              >
                <Pause className="w-4 h-4 mr-2" />
                ခဏရပ်ရန်
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={resumeRecording}
                className="h-12 flex-1 active:scale-[0.98] transition-transform text-sm"
              >
                <Play className="w-4 h-4 mr-2" />
                ဆက်မှတ်ရန်
              </Button>
            )}
            <Button
              type="button"
              variant="destructive"
              onClick={stopRecording}
              className="h-12 flex-1 active:scale-[0.98] transition-transform text-sm"
            >
              <Square className="w-4 h-4 mr-2" />
              ပြီးပြီ
            </Button>
          </div>
        )}

        {status === 'stopped' && audioUrl && (
          <div className="w-full space-y-4">
            <audio controls className="w-full h-12 rounded-lg">
              <source src={audioUrl} type="audio/webm" />
            </audio>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={resetRecording}
                className="h-12 flex-1 active:scale-[0.98] transition-transform text-sm"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                ပြန်စရန်
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={uploading}
                className="h-12 flex-1 gradient-primary hover:gradient-primary-hover text-white font-medium active:scale-[0.98] transition-transform text-sm"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                {uploading ? 'သိမ်းဆည်းနေသည်...' : 'သိမ်းဆည်းရန်'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
