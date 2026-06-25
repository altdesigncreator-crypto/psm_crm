import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, Timestamp, query, where, orderBy, limit, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { getDepartment } from '@/lib/roleUtils';
import { submitLead } from '@/lib/backgroundSync';
import { uploadFileWithFallback } from '@/lib/offlineStorageQueue';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Mic, Square, Loader2, MapPin, User, FileText, Clock, DollarSign, TrendingUp, ChevronRight, CheckCircle2, Navigation, LocateFixed, Users, X, AlertTriangle, Eye, Phone as PhoneIcon, Merge, Sparkles } from 'lucide-react';
import {
  STATUSES,
  INTEREST_TYPES,
  PROPERTY_TYPES,
  PURPOSES,
  URGENCIES,
  PAYMENT_METHODS,
  LEAD_SOURCES,
} from '@/types';
import { BudgetStepperInput } from '@/components/ui/budget-stepper-input';
import { haversineDistance, formatDistance } from '@/lib/distance';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function AddLead() {
  const navigate = useNavigate();
  const { user, role: userRole } = useAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Basic Info
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [currentLocation, setCurrentLocation] = useState('');

  // Requirements
  const [interestType, setInterestType] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [preferredProject, setPreferredProject] = useState('');
  const [budgetMin, setBudgetMin] = useState(0);
  const [budgetMax, setBudgetMax] = useState(100000);
  const [budgetUnlimited, setBudgetUnlimited] = useState(false);
  const [purpose, setPurpose] = useState('');

  // Timeline & Financials
  const [urgency, setUrgency] = useState('');
  const [urgencyRemarks, setUrgencyRemarks] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');

  // Sales Tracking
  const [leadSource, setLeadSource] = useState('');
  const [leadLevel, setLeadLevel] = useState('');
  const [status, setStatus] = useState('');
  const [assignedAgent, setAssignedAgent] = useState('');
  const [showPerson, setShowPerson] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [remarks, setRemarks] = useState('');

  // GPS & Auto-assign
  const [leadLat, setLeadLat] = useState<number | null>(null);
  const [leadLng, setLeadLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [nearestAgents, setNearestAgents] = useState<{ name: string; email: string; lat: number; lng: number; distance: number }[]>([]);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [findingAgents, setFindingAgents] = useState(false);

  // Duplicate Detection
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateLeads, setDuplicateLeads] = useState<{ id: string; name: string; phone: string; email?: string; status: string; assignedAgent?: string; createdAt?: string }[]>([]);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<any>(null);

  // AI Auto Scoring
  const [aiScoring, setAiScoring] = useState(false);
  const [aiScoreReason, setAiScoreReason] = useState('');

  // Voice Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= 29) {
            stopRecording();
            return 30;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setError('မိုင်ခရိုဖုန်းအသုံးပြုခွင့် ပြုပြီးပါပြီ သို့မဟုတ် ရရှိနိုင်ခြင်းမရှိပါ။');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const handleCaptureLeadGPS = () => {
    if (!navigator.geolocation) {
      toast.error('GPS ကိုမထောက်ပံ့ပါ');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLeadLat(pos.coords.latitude);
        setLeadLng(pos.coords.longitude);
        setGpsLoading(false);
        toast.success('Lead GPS ရယူခြင်း အောင်မြင်ပါသည်');
      },
      () => {
        setGpsLoading(false);
        toast.error('GPS ရယူ၍မရပါ — ခွင့်ပြုချက်စစ်ဆေးပါ');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleFindNearestAgents = async () => {
    if (leadLat == null || leadLng == null) {
      toast.error('အရင်ဦးစွာ Lead GPS ကို ရယူပါ');
      return;
    }
    setFindingAgents(true);
    setAgentPickerOpen(true);
    try {
      // Get latest check-in per agent (last 30 days)
      const q = query(
        collection(db, 'checkins'),
        orderBy('timestamp', 'desc'),
        limit(200)
      );
      const snap = await getDocs(q);
      const agentMap = new Map<string, { name: string; lat: number; lng: number; ts: number }>();
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const email = (data.agentName as string) || 'Unknown';
        const lat = Number(data.latitude) || 0;
        const lng = Number(data.longitude) || 0;
        const ts =
          typeof data.timestamp === 'object' && data.timestamp !== null && 'toMillis' in data.timestamp
            ? (data.timestamp as { toMillis: () => number }).toMillis()
            : Date.now();
        if (!agentMap.has(email) || agentMap.get(email)!.ts < ts) {
          agentMap.set(email, { name: email, lat, lng, ts });
        }
      });

      const agents = Array.from(agentMap.values())
        .filter((a) => a.lat !== 0 && a.lng !== 0)
        .map((a) => ({
          name: a.name,
          email: a.name,
          lat: a.lat,
          lng: a.lng,
          distance: haversineDistance(leadLat, leadLng, a.lat, a.lng),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);

      setNearestAgents(agents);
    } catch {
      toast.error('Agent ရှာဖွေရာတွင် အမှားဖြစ်သွားပါသည်');
    } finally {
      setFindingAgents(false);
    }
  };

  const selectNearestAgent = (agent: { name: string }) => {
    setAssignedAgent(agent.name);
    setAgentPickerOpen(false);
    toast.success(`Auto-assign: ${agent.name}`);
  };

  const handleAutoScore = async () => {
    const leadData = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      interestType: interestType || undefined,
      propertyType: propertyType || undefined,
      preferredProject: preferredProject || undefined,
      budgetRange: budgetUnlimited ? 'Unlimited' : `MMK ${budgetMin.toLocaleString()} - ${budgetMax.toLocaleString()}`,
      purpose: purpose || undefined,
      urgency: urgency || undefined,
      paymentMethod: paymentMethod || undefined,
      leadSource: leadSource || undefined,
      currentLocation: currentLocation.trim() || undefined,
      remarks: remarks.trim() || undefined,
    };
    setAiScoring(true);
    setAiScoreReason('');
    try {
      const { data, error } = await supabase.functions.invoke('lead-score', {
        body: { lead: leadData },
      });
      if (error) {
        const errorMsg = await error?.context?.text();
        throw new Error(errorMsg || error.message || 'Edge function error');
      }
      if (!data || !data.score) throw new Error('Invalid response from AI');
      setLeadLevel(data.level || 'Level C (Cold/Inquiring)');
      setAiScoreReason(data.reasoning || '');
      toast.success(`AI Score: ${data.score} — ${data.reasoning}`);
    } catch (err: any) {
      toast.error('AI စကိုးလုပ်ရာတွင် အမှားဖြစ်သွားပါသည်: ' + (err.message || ''));
    } finally {
      setAiScoring(false);
    }
  };

  const checkDuplicate = async () => {
    if (!phone.trim() && !email.trim()) return [];
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();

    const dupSet = new Map<string, { id: string; name: string; phone: string; email?: string; status: string; assignedAgent?: string; createdAt?: string }>();

    try {
      // Check by phone
      if (trimmedPhone) {
        const phoneQ = query(collection(db, 'leads'), where('phone', '==', trimmedPhone), limit(20));
        const phoneSnap = await getDocs(phoneQ);
        phoneSnap.docs.forEach((d) => {
          const raw = d.data() as Record<string, unknown>;
          dupSet.set(d.id, {
            id: d.id,
            name: (raw.name as string) || '—',
            phone: (raw.phone as string) || '',
            email: (raw.email as string) || undefined,
            status: (raw.status as string) || '',
            assignedAgent: (raw.assignedAgent as string) || undefined,
            createdAt: raw.createdAt && typeof (raw.createdAt as any).toDate === 'function'
              ? (raw.createdAt as any).toDate().toLocaleDateString('en-GB')
              : undefined,
          });
        });
      }
      // Check by email
      if (trimmedEmail) {
        const emailQ = query(collection(db, 'leads'), where('email', '==', trimmedEmail), limit(20));
        const emailSnap = await getDocs(emailQ);
        emailSnap.docs.forEach((d) => {
          const raw = d.data() as Record<string, unknown>;
          if (!dupSet.has(d.id)) {
            dupSet.set(d.id, {
              id: d.id,
              name: (raw.name as string) || '—',
              phone: (raw.phone as string) || '',
              email: (raw.email as string) || undefined,
              status: (raw.status as string) || '',
              assignedAgent: (raw.assignedAgent as string) || undefined,
              createdAt: raw.createdAt && typeof (raw.createdAt as any).toDate === 'function'
                ? (raw.createdAt as any).toDate().toLocaleDateString('en-GB')
                : undefined,
            });
          }
        });
      }
    } catch {
      // If duplicate check fails, allow user to proceed
    }

    return Array.from(dupSet.values());
  };

  const proceedWithSubmit = async () => {
    setDuplicateDialogOpen(false);
    setSubmitting(true);
    await doSubmit(pendingPayload);
    setPendingPayload(null);
  };

  const handleMerge = async (existingLeadId: string) => {
    if (!pendingPayload) return;
    setDuplicateDialogOpen(false);
    setSubmitting(true);
    try {
      const leadRef = doc(db, 'leads', existingLeadId);
      // Build merge payload — only overwrite non-null new values, keep existing for nulls
      const mergePayload: Record<string, any> = {};
      const newData = pendingPayload;

      if (newData.name) mergePayload.name = newData.name;
      if (newData.phone) mergePayload.phone = newData.phone;
      if (newData.email !== null) mergePayload.email = newData.email;
      if (newData.currentLocation !== null) mergePayload.currentLocation = newData.currentLocation;
      if (newData.interestType !== null) mergePayload.interestType = newData.interestType;
      if (newData.propertyType !== null) mergePayload.propertyType = newData.propertyType;
      if (newData.preferredProject) mergePayload.preferredProject = newData.preferredProject;
      if (newData.budgetRange) mergePayload.budgetRange = newData.budgetRange;
      if (newData.purpose !== null) mergePayload.purpose = newData.purpose;
      if (newData.urgency !== null) mergePayload.urgency = newData.urgency;
      if (newData.urgencyRemarks !== null) mergePayload.urgencyRemarks = newData.urgencyRemarks;
      if (newData.paymentMethod !== null) mergePayload.paymentMethod = newData.paymentMethod;
      if (newData.leadSource !== null) mergePayload.leadSource = newData.leadSource;
      if (newData.leadLevel) mergePayload.leadLevel = newData.leadLevel;
      if (newData.status) mergePayload.status = newData.status;
      if (newData.assignedAgent !== null) mergePayload.assignedAgent = newData.assignedAgent;
      if (newData.showPerson !== null) mergePayload.showPerson = newData.showPerson;
      if (newData.nextFollowUpDate !== null) mergePayload.nextFollowUpDate = newData.nextFollowUpDate;
      if (newData.remarks !== null) mergePayload.remarks = newData.remarks;
      if (newData.voiceNoteURL !== null) mergePayload.voiceNoteURL = newData.voiceNoteURL;
      if (newData.latitude !== null) mergePayload.latitude = newData.latitude;
      if (newData.longitude !== null) mergePayload.longitude = newData.longitude;
      if (newData.leadLat !== null) mergePayload.leadLat = newData.leadLat;
      if (newData.leadLng !== null) mergePayload.leadLng = newData.leadLng;
      mergePayload.updatedAt = Timestamp.now();

      await updateDoc(leadRef, mergePayload);
      toast.success('Lead data merge ပြီးပါပြီ');
      navigate(`/lead/${existingLeadId}`);
    } catch (err: any) {
      setError(err.message || 'Merge လုပ်ဆောင်ရာတွင် အမှားဖြစ်သွားပါသည်။');
    } finally {
      setSubmitting(false);
      setPendingPayload(null);
    }
  };

  const doSubmit = async (leadPayload: any) => {
    try {
      // Use submitLead helper which handles offline queue automatically
      await submitLead(leadPayload);

      // Write unified notification for Boss/Admin real-time feed (best-effort, non-blocking)
      try {
        await addDoc(collection(db, 'notifications'), {
          title: 'Lead အသစ်တင်ပြခြင်း',
          message: `${name.trim()} - ${preferredProject}`,
          type: 'appointment',
          agentName: user?.email || 'Unknown',
          timestamp: Timestamp.now(),
          isRead: false,
        });
      } catch (notifErr) {
        // Notification write failure should not fail the lead creation
        // eslint-disable-next-line no-console
        console.warn('Lead notification write failed:', notifErr);
      }

      navigate('/leads');
    } catch (err: any) {
      setError(err.message || 'Lead သိမ်းဆည်းရာတွင် အမှားတစ်ခုဖြစ်ပွားခဲ့သည်။ ပြန်လည်ကြိုးစားပါ။');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !phone.trim() || !preferredProject.trim() || !status || !leadLevel) {
      setError('ဝယ်သူအမည်၊ ဖုန်းနံပါတ်၊ Project၊ Lead Level နှင့် အခြေအနေ အားလုံး ဖြည့်ရန်လိုအပ်ပါသည်။');
      return;
    }

    setCheckingDuplicate(true);
    const duplicates = await checkDuplicate();
    setCheckingDuplicate(false);

    if (duplicates.length > 0) {
      setDuplicateLeads(duplicates);

      let voiceNoteURL = '';
      if (audioBlob) {
        const fileName = `voice_notes/${Date.now()}_${Math.random().toString(36).slice(2)}.webm`;
        const voicePayload = {
          userId: user?.uid || '',
          ownerId: user?.uid || '',
          agentName: user?.email || 'Unknown',
          department: getDepartment(userRole),
        };
        try {
          voiceNoteURL = await uploadFileWithFallback(
            'voice_note',
            'audio_notes',
            voicePayload,
            'audioUrl',
            fileName,
            audioBlob
          );
        } catch (err: any) {
          if (err.message === 'OFFLINE_QUEUED') {
            toast.info('Voice note ကို offline queue တွင် သိမ်းဆည်းထားပါသည်။');
            voiceNoteURL = '';
          }
        }
      }

      let latitude: number | null = null;
      let longitude: number | null = null;
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      } catch {
        // Silently ignore geolocation errors
      }

      const leadPayload = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        currentLocation: currentLocation.trim() || null,
        interestType: interestType || null,
        propertyType: propertyType || null,
        preferredProject,
        budgetRange: budgetUnlimited
          ? `သိန်း ${budgetMin.toLocaleString('en-US')} မှ အကန့်အသတ်မရှိ`
          : `သိန်း ${budgetMin.toLocaleString('en-US')} မှ ${budgetMax.toLocaleString('en-US')} ကြား`,
        purpose: purpose || null,
        urgency: urgency || null,
        urgencyRemarks: urgencyRemarks.trim() || null,
        paymentMethod: paymentMethod || null,
        leadSource: leadSource || null,
        leadLevel,
        status,
        assignedAgent: assignedAgent.trim() || null,
        showPerson: showPerson.trim() || null,
        nextFollowUpDate: nextFollowUpDate || null,
        remarks: remarks.trim() || null,
        voiceNoteURL: voiceNoteURL || null,
        latitude,
        longitude,
        leadLat: leadLat,
        leadLng: leadLng,
        ownerId: user?.uid || '',
        department: getDepartment(userRole),
      };

      setPendingPayload(leadPayload);
      setDuplicateDialogOpen(true);
      return;
    }

    setSubmitting(true);

    try {
      let voiceNoteURL = '';
      if (audioBlob) {
        const fileName = `voice_notes/${Date.now()}_${Math.random().toString(36).slice(2)}.webm`;
        const voicePayload = {
          userId: user?.uid || '',
          ownerId: user?.uid || '',
          agentName: user?.email || 'Unknown',
          department: getDepartment(userRole),
        };
        try {
          voiceNoteURL = await uploadFileWithFallback(
            'voice_note',
            'audio_notes',
            voicePayload,
            'audioUrl',
            fileName,
            audioBlob
          );
        } catch (err: any) {
          if (err.message === 'OFFLINE_QUEUED') {
            toast.info('Voice note ကို offline queue တွင် သိမ်းဆည်းထားပါသည်။ အင်တာနက် ပြန်လာလျှင် auto-upload လုပ်ပေးပါမည်။');
            voiceNoteURL = '';
          } else {
            throw err;
          }
        }
      }

      let latitude: number | null = null;
      let longitude: number | null = null;

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      } catch {
        // Silently ignore geolocation errors
      }

      const leadPayload = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        currentLocation: currentLocation.trim() || null,
        interestType: interestType || null,
        propertyType: propertyType || null,
        preferredProject,
        budgetRange: budgetUnlimited
          ? `သိန်း ${budgetMin.toLocaleString('en-US')} မှ အကန့်အသတ်မရှိ`
          : `သိန်း ${budgetMin.toLocaleString('en-US')} မှ ${budgetMax.toLocaleString('en-US')} ကြား`,
        purpose: purpose || null,
        urgency: urgency || null,
        urgencyRemarks: urgencyRemarks.trim() || null,
        paymentMethod: paymentMethod || null,
        leadSource: leadSource || null,
        leadLevel,
        status,
        assignedAgent: assignedAgent.trim() || null,
        showPerson: showPerson.trim() || null,
        nextFollowUpDate: nextFollowUpDate || null,
        remarks: remarks.trim() || null,
        voiceNoteURL: voiceNoteURL || null,
        latitude,
        longitude,
        ownerId: user?.uid || '',
        department: getDepartment(userRole),
      };

      // Use submitLead helper which handles offline queue automatically
      await submitLead(leadPayload);

      // Write unified notification for Boss/Admin real-time feed (best-effort, non-blocking)
      try {
        await addDoc(collection(db, 'notifications'), {
          title: 'Lead အသစ်တင်ပြခြင်း',
          message: `${name.trim()} - ${preferredProject}`,
          type: 'appointment',
          agentName: user?.email || 'Unknown',
          timestamp: Timestamp.now(),
          isRead: false,
        });
      } catch (notifErr) {
        // Notification write failure should not fail the lead creation
        // eslint-disable-next-line no-console
        console.warn('Lead notification write failed:', notifErr);
      }

      navigate('/leads');
    } catch (err: any) {
      setError(err.message || 'Lead သိမ်းဆည်းရာတွင် အမှားတစ်ခုဖြစ်ပွားခဲ့သည်။ ပြန်လည်ကြိုးစားပါ။');
    } finally {
      setSubmitting(false);
    }
  };

  const SectionHeader = ({ icon: Icon, title, stepNum }: { icon: any; title: string; stepNum?: number }) => (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0">
        {stepNum && (
          <p className="text-[10px] font-medium text-primary uppercase tracking-wider">အဆင့် {stepNum} / ၅</p>
        )}
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h3>
      </div>
    </div>
  );

  // Mobile step wizard steps
  const steps = [
    { icon: User, title: 'အခြေခံ' },
    { icon: FileText, title: 'စိတ်ဝင်စားမှု' },
    { icon: Clock, title: 'အချိန်ဇယား' },
    { icon: TrendingUp, title: 'အရောင်း' },
    { icon: MapPin, title: 'အဆင့်မြင့်' },
  ];

  return (
    <div className="max-w-4xl mx-auto animate-fade-in-up">
      <div className="mb-5">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground">Customer Lead အသစ်ထည့်ရန်</h1>
        <p className="text-sm text-muted-foreground mt-1">Capture comprehensive lead information</p>
      </div>

      {/* Mobile Step Wizard */}
      <div className="md:hidden mb-5 overflow-x-auto -mx-4 px-4 snap-x snap-mandatory">
        <div className="flex items-center gap-2 min-w-max">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-2 snap-start">
              <div className="flex flex-col items-center gap-1 min-w-[64px]">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <step.icon className="w-4 h-4 text-primary" />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">{step.title}</span>
              </div>
              {idx < steps.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 -mt-4" />
              )}
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Basic Info */}
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={User} title="အခြေခံအချက်အလက်များ" stepNum={1} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">ဝယ်သူအမည် <span className="text-destructive">*</span></Label>
                  <Input placeholder="ဝယ်သူအမည်" value={name} onChange={(e) => setName(e.target.value)} required className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">ဖုန်းနံပါတ် <span className="text-destructive">*</span></Label>
                  <Input type="tel" placeholder="ဖုန်းနံပါတ်" value={phone} onChange={(e) => setPhone(e.target.value)} required className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">အီးမေးလ်</Label>
                  <Input type="email" placeholder="အီးမေးလ်" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">လက်ရှိနေထိုင်ရာ လိပ်စာ</Label>
                  <Input placeholder="လက်ရှိနေထိုင်ရာ လိပ်စာ" value={currentLocation} onChange={(e) => setCurrentLocation(e.target.value)} className="h-12" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Requirements */}
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={FileText} title="စိတ်ဝင်စားသည့်အချက်များ" stepNum={2} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">စိတ်ဝင်စားသည့် အမျိုးအစား</Label>
                  <Select value={interestType} onValueChange={setInterestType}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="စိတ်ဝင်စားသည့် အမျိုးအစား ရွေးချယ်ပါ" /></SelectTrigger>
                    <SelectContent>{INTEREST_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">အိမ်ခြံမြေ အမျိုးအစား</Label>
                  <Select value={propertyType} onValueChange={setPropertyType}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="အိမ်ခြံမြေ အမျိုးအစား ရွေးချယ်ပါ" /></SelectTrigger>
                    <SelectContent>{PROPERTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">စိတ်ဝင်စားသည့် Project <span className="text-destructive">*</span></Label>
                  <Select value={preferredProject} onValueChange={setPreferredProject}>
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder="Project ရွေးချယ်ပါ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Dagon Landmark Residence">Dagon Landmark Residence</SelectItem>
                      <SelectItem value="Emerald Bay Tower 3">Emerald Bay Tower 3</SelectItem>
                      <SelectItem value="Perfect Signature Residence">Perfect Signature Residence</SelectItem>
                      <SelectItem value="Bahtoo Gyi Condo">Bahtoo Gyi Condo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3 md:col-span-2">
                  <Label className="text-sm font-medium">ခန့်မှန်း ဘတ်ဂျက်</Label>
                  <BudgetStepperInput
                    minValue={budgetMin}
                    maxValue={budgetMax}
                    isUnlimited={budgetUnlimited}
                    step={1000}
                    onMinChange={setBudgetMin}
                    onMaxChange={setBudgetMax}
                    onUnlimitedToggle={setBudgetUnlimited}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">ရည်ရွယ်ချက်</Label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="ရည်ရွယ်ချက် ရွေးချယ်ပါ" /></SelectTrigger>
                    <SelectContent>{PURPOSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Timeline & Financials */}
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={Clock} title="အချိန်ဇယား နှင့် ငွေကြေးစီမံချက်" stepNum={3} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">ဝယ်ယူလိုသည့် အချိန်ကာလ</Label>
                  <Select value={urgency} onValueChange={setUrgency}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="အချိန်ကာလ ရွေးချယ်ပါ" /></SelectTrigger>
                    <SelectContent>{URGENCIES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input
                    placeholder="မှတ်ချက် — ဥပမာ 45 days"
                    value={urgencyRemarks}
                    onChange={(e) => setUrgencyRemarks(e.target.value)}
                    className="h-12 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">ငွေချေမည့်စနစ်</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="ငွေချေစနစ် ရွေးချယ်ပါ" /></SelectTrigger>
                    <SelectContent>{PAYMENT_METHODS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sales Tracking */}
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={TrendingUp} title="အရောင်းစီမံခန့်ခွဲမှု" stepNum={4} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">သိရှိခဲ့သည့် လမ်းကြောင်း</Label>
                  <Select value={leadSource} onValueChange={setLeadSource}>
                    <SelectTrigger className="h-12"><SelectValue placeholder="လမ်းကြောင်း ရွေးချယ်ပါ" /></SelectTrigger>
                    <SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Lead အဆင့် <span className="text-destructive">*</span></Label>
                    <button
                      type="button"
                      onClick={handleAutoScore}
                      disabled={aiScoring}
                      className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 disabled:opacity-40 transition-colors"
                    >
                      {aiScoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {aiScoring ? 'စိတ်ပိုင်းနေသည်...' : 'AI စကိုးလုပ်ရန်'}
                    </button>
                  </div>
                  <Select value={leadLevel} onValueChange={setLeadLevel} required>
                    <SelectTrigger className="h-12"><SelectValue placeholder="Lead အဆင့် ရွေးချယ်ပါ" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Level A (Hot/Ready)">Level A (Hot/Ready)</SelectItem>
                      <SelectItem value="Level B (Warm/Considering)">Level B (Warm/Considering)</SelectItem>
                      <SelectItem value="Level C (Cold/Inquiring)">Level C (Cold/Inquiring)</SelectItem>
                    </SelectContent>
                  </Select>
                  {aiScoreReason && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">
                      🤖 {aiScoreReason}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">လက်ရှိ အခြေအနေ <span className="text-destructive">*</span></Label>
                  <Select value={status} onValueChange={setStatus} required>
                    <SelectTrigger className="h-12"><SelectValue placeholder="အခြေအနေ ရွေးချယ်ပါ" /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Sale Person</Label>
                  <div className="flex items-center gap-2">
                    <Input placeholder="Sale Person အမည်" value={assignedAgent} onChange={(e) => setAssignedAgent(e.target.value)} className="h-12 flex-1" />
                    <button
                      type="button"
                      onClick={handleFindNearestAgents}
                      disabled={findingAgents || leadLat == null}
                      className="h-12 px-3 rounded-xl border border-primary/30 text-primary bg-primary/5 active:bg-primary/10 active:scale-[0.98] transition-all shrink-0 text-xs font-medium flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <LocateFixed className="w-4 h-4" />
                      <span className="hidden md:inline">အနီးဆုံး</span>
                    </button>
                  </div>
                  {leadLat != null && leadLng != null && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      Lead GPS: {leadLat.toFixed(5)}, {leadLng.toFixed(5)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Show Person</Label>
                  <Input
                    placeholder="Show Person အမည်"
                    value={showPerson}
                    onChange={(e) => setShowPerson(e.target.value)}
                    className="h-12 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">နောက်တစ်ကြိမ် ဆက်သွယ်ရမည့်ရက်</Label>
                  <Input type="date" value={nextFollowUpDate} onChange={(e) => setNextFollowUpDate(e.target.value)} className="h-12" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">မှတ်ချက် / အထူးတောင်းဆိုချက်များ</Label>
                  <Textarea placeholder="မှတ်ချက်များ ထည့်သွင်းပါ..." value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[100px]" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Advanced Tracking */}
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5 md:p-6">
              <SectionHeader icon={MapPin} title="အဆင့်မြင့်ခြေရာခံခြင်း" stepNum={5} />
              <div className="space-y-5">
                {/* Lead GPS Capture */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Lead GPS နေရာ</Label>
                  <button
                    type="button"
                    onClick={handleCaptureLeadGPS}
                    disabled={gpsLoading}
                    className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        {gpsLoading ? (
                          <Loader2 className="w-5 h-5 text-primary animate-spin" />
                        ) : leadLat != null ? (
                          <Navigation className="w-5 h-5 text-success" />
                        ) : (
                          <MapPin className="w-5 h-5 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {leadLat != null ? 'GPS ရယူသွားပါပြီ' : 'Lead GPS ရယူရန်'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {leadLat != null
                            ? `${leadLat.toFixed(5)}, ${leadLng?.toFixed(5)}`
                            : 'အနီးဆုံး Sale Person ရှာဖွေရန် GPS လိုအပ်ပါသည်'}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">အသံဖြင့် မှတ်တမ်းတင်ရန်</Label>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant={isRecording ? 'destructive' : 'outline'}
                      className={`h-12 gap-2 text-sm font-medium ${isRecording ? '' : 'border-primary/30 text-primary hover:bg-primary/5'}`}
                      onClick={isRecording ? stopRecording : startRecording}
                    >
                      {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      {isRecording ? 'မှတ်တမ်းတင်ခြင်း ရပ်ရန်' : audioBlob ? 'ပြန်မှတ်တမ်းတင်ရန်' : 'အသံဖြင့် မှတ်တမ်းတင်ရန် (စက္ကန့် ၃၀)'}
                    </Button>
                    {isRecording && (
                      <span className="text-sm font-medium text-destructive">{recordingTime}s / 30s</span>
                    )}
                    {audioBlob && !isRecording && (
                      <span className="text-sm text-muted-foreground">မှတ်တမ်းသိမ်းပြီးပါပြီ</span>
                    )}
                  </div>
                  {audioBlob && (
                    <audio controls className="w-full h-12 mt-2">
                      <source src={URL.createObjectURL(audioBlob)} type="audio/webm" />
                    </audio>
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="w-4 h-4" />
                  <span>GPS ကိုဩဒိနိတ်များ ဖောင်တင်ခြင်းအချိန်တွင် အလိုအလျောက် ရယူမည်</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Submit — fixed on mobile for thumb reach */}
          <div className="md:static fixed bottom-16 left-0 right-0 z-40 px-4 py-3 bg-card/95 backdrop-blur-lg border-t border-border md:bg-transparent md:backdrop-blur-none md:border-none md:px-0 md:py-0">
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-3 mb-3 md:mb-0">
                {error}
              </div>
            )}
            <Button
              type="submit"
              disabled={submitting || checkingDuplicate}
              className="w-full h-14 md:h-12 gradient-primary hover:gradient-primary-hover text-white font-semibold text-base transition-all duration-300 hover:shadow-card-hover shadow-lg md:shadow-none active:scale-[0.98]"
            >
              {checkingDuplicate ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Duplicate စစ်ဆေးနေသည်...
                </>
              ) : submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  သိမ်းဆည်းနေသည်...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  အချက်အလက်များ သိမ်းဆည်းရန်
                </>
              )}
            </Button>
          </div>
        </div>
      </form>

      {/* Nearest Agent Picker Dialog */}
      <Dialog open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              အနီးဆုံး Sale Person များ
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-3 max-h-[60vh] overflow-y-auto">
            {findingAgents ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : nearestAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <MapPin className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm font-medium">Agent မှတ်တမ်း မတွေ့ပါ</p>
                <p className="text-xs mt-1">Check-in မှတ်တမ်းရှိသော Agent များမှ ရှာဖွေပါသည်</p>
              </div>
            ) : (
              nearestAgents.map((agent, idx) => (
                <button
                  key={agent.email}
                  type="button"
                  onClick={() => selectNearestAgent(agent)}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 active:scale-[0.99] transition-all text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">{formatDistance(agent.distance)} အကွာ</p>
                  </div>
                  <div className="shrink-0 text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-full">
                    {agent.distance < 1 ? `${(agent.distance * 1000).toFixed(0)} m` : `${agent.distance.toFixed(1)} km`}
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicate Lead Warning Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Duplicate Lead တွေ့ရှိပါသည်
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              ဤ အီးမေးလ် သို့မဟုတ် ဖုန်းနံပါတ်ဖြင့် Lead ရှိပြီးသားဖြစ်နိုင်ပါသည်။ အောက်ပါ အချက်အလက်များကို စစ်ဆေးပါ —
            </p>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {duplicateLeads.map((dup) => (
                <div
                  key={dup.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card"
                >
                  <div className="w-9 h-9 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
                    <PhoneIcon className="w-4 h-4 text-warning" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{dup.name}</p>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                        dup.status === 'Closed' ? 'bg-success/10 text-success border-success/20' :
                        dup.status === 'New' ? 'bg-info/10 text-info border-info/20' :
                        'bg-muted text-muted-foreground border-border'
                      }`}>
                        {dup.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <PhoneIcon className="w-3 h-3" />
                        {dup.phone}
                      </span>
                      {dup.email && (
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {dup.email}
                        </span>
                      )}
                      {dup.assignedAgent && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {dup.assignedAgent}
                        </span>
                      )}
                      {dup.createdAt && (
                        <span>{dup.createdAt}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/lead/${dup.id}`)}
                    className="shrink-0 flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 active:bg-primary/20 rounded-md px-2 py-1 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">ကြည့်ရန်</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <p className="text-xs text-muted-foreground">ရှိပြီးသား lead တစ်ခုကို ရွေးချယ်၍ data merge လုပ်နိုင်ပါသည်</p>
              <div className="flex flex-col sm:flex-row items-stretch gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-11 border-border"
                  onClick={() => {
                    setDuplicateDialogOpen(false);
                    setPendingPayload(null);
                  }}
                >
                  <X className="w-4 h-4 mr-1.5" />
                  ပယ်ဖျက်ရန်
                </Button>
                {duplicateLeads.length === 1 && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1 h-11 gap-2 active:scale-[0.98]"
                    onClick={() => handleMerge(duplicateLeads[0].id)}
                    disabled={submitting}
                  >
                    <Merge className="w-4 h-4" />
                    {submitting ? 'Merging...' : 'Merge လုပ်ရန်'}
                  </Button>
                )}
                <Button
                  type="button"
                  className="flex-1 h-11 gradient-primary hover:gradient-primary-hover text-white font-medium active:scale-[0.98]"
                  onClick={proceedWithSubmit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  )}
                  ထည့်သွင်းရန်
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
