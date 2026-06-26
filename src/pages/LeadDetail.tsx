import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  MapPin,
  Building2,
  DollarSign,
  Target,
  Calendar,
  CreditCard,
  TrendingUp,
  MessageSquare,
  Mic,
  Navigation,
  Clock,
  FileText,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { type Lead } from '@/types';
import { useStatusColors } from '@/hooks/useStatusColors';
import { toast } from 'sonner';
import StatusBadge from '@/components/StatusBadge';
import VoiceRecorder from '@/components/VoiceRecorder';
import VoiceNotesList from '@/components/VoiceNotesList';

interface DetailRowProps {
  label: string;
  value?: string | null;
  icon?: React.ReactNode;
}

function DetailRow({ label, value, icon }: DetailRowProps) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 min-h-[48px]">
      {icon && <div className="mt-0.5 text-muted-foreground shrink-0">{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-foreground mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const { colors: statusColors } = useStatusColors();
  const [aiScoring, setAiScoring] = useState(false);
  const [aiScoreReason, setAiScoreReason] = useState('');

  useEffect(() => {
    if (!id) return;
    const fetchLead = async () => {
      try {
        const snap = await getDoc(doc(db, 'leads', id));
        if (snap.exists()) {
          setLead({ id: snap.id, ...snap.data() } as Lead);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchLead();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground">
        <FileText className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">Lead မတွေ့ပါ</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/leads')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Lead များသို့ ပြန်သွားရန်
        </Button>
      </div>
    );
  }

  const handleAiRescore = async () => {
    if (!lead) return;
    setAiScoring(true);
    setAiScoreReason('');
    try {
      const leadData = {
        name: lead.name,
        phone: lead.phone,
        email: lead.email || undefined,
        interestType: lead.interestType || undefined,
        propertyType: lead.propertyType || undefined,
        preferredProject: lead.preferredProject || undefined,
        budgetRange: lead.budgetRange || undefined,
        purpose: lead.purpose || undefined,
        urgency: lead.urgency || undefined,
        paymentMethod: lead.paymentMethod || undefined,
        leadSource: lead.leadSource || undefined,
        currentLocation: lead.currentLocation || undefined,
        remarks: lead.remarks || undefined,
      };
      const res = await fetch('https://app-chfyozakqsqp-api-VaOwP8E7dJqa.gateway.appmedo.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `You are a real estate CRM AI scoring assistant. Analyze the following lead data and score it as A, B, or C based on buying intent, budget clarity, urgency, and source quality.

Scoring criteria:
- A (Hot/Ready): Clear budget, urgent timeline, high-quality source, specific project interest, ready to view/buy
- B (Warm/Considering): Moderate budget range, some urgency, considering options, needs follow-up
- C (Cold/Inquiring): Vague budget, no urgency, just browsing, low-quality source

Lead data:
${JSON.stringify(leadData, null, 2)}

Respond ONLY in this exact JSON format (no markdown, no extra text):
{"score":"A|B|C","reasoning":"brief reason in Myanmar language"}` }],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error('AI service unavailable');
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) fullText += text;
            } catch {
              // skip
            }
          }
        }
      }
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse AI response');
      const result = JSON.parse(jsonMatch[0]);
      const score = String(result.score || 'C').trim().toUpperCase();
      const reasoning = String(result.reasoning || '');
      const levelMap: Record<string, string> = {
        'A': 'Level A (Hot/Ready)',
        'B': 'Level B (Warm/Considering)',
        'C': 'Level C (Cold/Inquiring)',
      };
      const newLevel = levelMap[score] || levelMap['C'];
      // Update Firestore
      const { updateDoc, doc } = await import('firebase/firestore');
      const { db } = await import('@/lib/firebase');
      await updateDoc(doc(db, 'leads', lead.id), { leadLevel: newLevel });
      setLead((prev) => (prev ? { ...prev, leadLevel: newLevel } : prev));
      setAiScoreReason(reasoning);
      toast.success(`AI Re-score: ${score} — ${reasoning}`);
    } catch (err: any) {
      toast.error('AI စကိုးလုပ်ရာတွင် အမှားဖြစ်သွားပါသည်: ' + (err.message || ''));
    } finally {
      setAiScoring(false);
    }
  };

  const createdDate = lead.createdAt?.toDate
    ? lead.createdAt.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : lead.createdAt?.seconds
      ? new Date(lead.createdAt.seconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/leads')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Lead Profile</h1>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{lead.name} — {lead.phone}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lead.leadLevel && (
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
              lead.leadLevel.includes('A') ? 'bg-success/10 text-success border-success/20' :
              lead.leadLevel.includes('B') ? 'bg-warning/10 text-warning border-warning/20' :
              'bg-info/10 text-info border-info/20'
            }`}>
              {lead.leadLevel.replace('Level ', '')}
            </span>
          )}
          <StatusBadge
            status={lead.status}
            color={statusColors[lead.status] || '#8FA3BF'}
            className="px-4 py-1.5 text-sm font-semibold"
          />
        </div>
      </div>

      {/* Mobile Quick Action Bar */}
      <div className="md:hidden flex items-center gap-2 -mx-4 px-4 py-3 bg-card border-y border-border sticky top-0 z-30">
        {lead.phone && (
          <a
            href={`tel:${lead.phone}`}
            className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl bg-primary text-white font-medium text-sm active:bg-primary/90 active:scale-[0.98] transition-all shadow-sm"
          >
            <Phone className="w-4 h-4" />
            ဆက်သွယ်ရန်
          </a>
        )}
        {lead.latitude && lead.longitude && (
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl border border-primary/30 text-primary font-medium text-sm active:bg-primary/5 active:scale-[0.98] transition-all"
          >
            <MapPin className="w-4 h-4" />
            တည်နေရာ
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Left Column - Basic Info */}
        <div className="lg:col-span-1 space-y-4 md:space-y-6">
          {/* Profile Card */}
          <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                အခြေခံအချက်အလက်များ
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1 flex-1">
              <DetailRow label="ဝယ်သူအမည်" value={lead.name} icon={<User className="w-4 h-4" />} />
              <DetailRow label="ဖုန်းနံပါတ်" value={lead.phone} icon={<Phone className="w-4 h-4" />} />
              <DetailRow label="အီးမေးလ်" value={lead.email} icon={<Mail className="w-4 h-4" />} />
              <DetailRow label="လက်ရှိနေထိုင်ရာ" value={lead.currentLocation} icon={<MapPin className="w-4 h-4" />} />
              <DetailRow label="ဖန်တီးသည့်ရက်" value={createdDate} icon={<Clock className="w-4 h-4" />} />
              {lead.leadLevel && (
                <div className="flex items-start gap-3 py-2.5 min-h-[48px]">
                  <div className="mt-0.5 text-muted-foreground shrink-0"><TrendingUp className="w-4 h-4" /></div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Lead အဆင့်</p>
                    <p className="text-sm font-medium text-foreground mt-0.5">{lead.leadLevel}</p>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={handleAiRescore}
                disabled={aiScoring}
                className="w-full h-11 flex items-center justify-center gap-2 rounded-xl border border-primary/30 text-primary bg-primary/5 active:bg-primary/10 active:scale-[0.98] transition-all text-sm font-medium disabled:opacity-40 mt-1"
              >
                {aiScoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {aiScoring ? 'AI စကိုးလုပ်နေသည်...' : 'AI ဖြင့် Re-score လုပ်ရန်'}
              </button>
              {aiScoreReason && (
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">
                  🤖 {aiScoreReason}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Voice Notes */}
          <Card className="shadow-card rounded-xl border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Mic className="w-4 h-4 text-primary" />
                </div>
                အသံဖြင့် မှတ်တမ်းတင်ရန်
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-5">
              <VoiceRecorder parentId={lead.id} parentType="lead" />
              <VoiceNotesList parentId={lead.id} parentType="lead" />
            </CardContent>
          </Card>

          {/* GPS Location */}
          {lead.latitude && lead.longitude && (
            <Card className="shadow-card rounded-xl border-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Navigation className="w-4 h-4 text-primary" />
                  </div>
                  မှတ်တမ်းတင်ထားသော နေရာအချက်အလက်
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <DetailRow label="လောင်ဂျီတူဒ်" value={lead.latitude.toFixed(6)} icon={<MapPin className="w-4 h-4" />} />
                <DetailRow label="လက်တီတူဒ်" value={lead.longitude.toFixed(6)} icon={<MapPin className="w-4 h-4" />} />
                <Button
                  variant="outline"
                  className="w-full h-12 gap-2 text-primary border-primary/30 hover:bg-primary/5 active:bg-primary/10 active:scale-[0.98] text-base md:text-sm font-medium transition-all"
                  onClick={() => setMapOpen(true)}
                >
                  <MapPin className="w-4 h-4" />
                  မြေပုံပေါ်တွင် ကြည့်ရန်
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Detailed Info */}
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          {/* Requirements */}
          <Card className="shadow-card rounded-xl border-0 h-full flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Target className="w-4 h-4 text-primary" />
                </div>
                စိတ်ဝင်စားသည့်အချက်များ
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                <DetailRow label="စိတ်ဝင်စားသည့် အမျိုးအစား" value={lead.interestType} icon={<TrendingUp className="w-4 h-4" />} />
                <DetailRow label="အိမ်ခြံမြေ အမျိုးအစား" value={lead.propertyType} icon={<Building2 className="w-4 h-4" />} />
                <DetailRow label="စိတ်ဝင်စားသည့် Project" value={lead.preferredProject} icon={<Building2 className="w-4 h-4" />} />
                <DetailRow label="ခန့်မှန်း ဘတ်ဂျက်" value={lead.budgetRange} icon={<DollarSign className="w-4 h-4" />} />
                <DetailRow label="ရည်ရွယ်ချက်" value={lead.purpose} icon={<Target className="w-4 h-4" />} />
              </div>
            </CardContent>
          </Card>

          {/* Timeline & Financials */}
          <Card className="shadow-card rounded-xl border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-primary" />
                </div>
                အချိန်ဇယား နှင့် ငွေကြေးစီမံချက်
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                <DetailRow label="ဝယ်ယူလိုသည့် အချိန်ကာလ" value={lead.urgency} icon={<Clock className="w-4 h-4" />} />
                <DetailRow label="ငွေချေမည့်စနစ်" value={lead.paymentMethod} icon={<CreditCard className="w-4 h-4" />} />
              </div>
            </CardContent>
          </Card>

          {/* Sales Tracking */}
          <Card className="shadow-card rounded-xl border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                အရောင်းစီမံခန့်ခွဲမှု
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                <DetailRow label="သိရှိခဲ့သည့် လမ်းကြောင်း" value={lead.leadSource} icon={<TrendingUp className="w-4 h-4" />} />
                <DetailRow label="Sale Person" value={lead.assignedAgent} icon={<User className="w-4 h-4" />} />
                <DetailRow label="Show Person" value={lead.showPerson} icon={<User className="w-4 h-4" />} />
                <DetailRow label="နောက်ဆက်သွယ်ရန်" value={lead.nextFollowUpDate} icon={<Calendar className="w-4 h-4" />} />
              </div>
              {lead.remarks && (
                <>
                  <Separator className="my-3" />
                  <div className="flex items-start gap-3 py-1">
                    <MessageSquare className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">မှတ်ချက် / အထူးတောင်းဆိုချက်များ</p>
                      <p className="text-sm font-medium text-foreground mt-1 break-words leading-relaxed">{lead.remarks}</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Map Modal */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-base font-semibold">Lead တည်နေရာ</DialogTitle>
          </DialogHeader>
          {lead.latitude && lead.longitude && (
            <div className="px-6 pb-6">
              <p className="text-sm text-muted-foreground mb-3">
                {lead.name} — Lat: {lead.latitude.toFixed(5)}, Lng: {lead.longitude.toFixed(5)}
              </p>
              <div className="w-full aspect-video rounded-lg overflow-hidden border border-border">
                <iframe
                  title="Lead Location"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&q=${lead.latitude},${lead.longitude}&zoom=15`}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
