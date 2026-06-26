import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { isManagement, isAdmin, getDepartment } from '@/lib/roleUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft,
  Users,
  Footprints,
  TrendingUp,
  Target,
  User,
  Phone,
  MapPin,
  Building2,
  Calendar,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { type Lead } from '@/types';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import StatusBadge from '@/components/StatusBadge';
import { useStatusColors } from '@/hooks/useStatusColors';

interface CheckinItem {
  id: string;
  agentName: string;
  project: string;
  photoURL?: string;
  latitude?: number;
  longitude?: number;
  timestamp?: any;
}

function getAgentEmail(lead: Lead): string {
  return (lead as any).agentName || lead.assignedAgent || 'မခန့်ထားပါ';
}

export default function AgentDetail() {
  const { email } = useParams<{ email: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { colors: statusColors } = useStatusColors();
  const decodedEmail = decodeURIComponent(email || '');

  const [leads, setLeads] = useState<Lead[]>([]);
  const [checkins, setCheckins] = useState<CheckinItem[]>([]);
  const [targetDept, setTargetDept] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [loading, setLoading] = useState(true);

  if (!isManagement(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
        <Target className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-base font-medium">ဤစာမျက်နှာကို Boss အကောင့်ဖြင့်သာ ဝင်ရောက်နိုင်ပါသည်</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Dashboard သို့ ပြန်သွားရန်
        </Button>
      </div>
    );
  }

  useEffect(() => {
    const unsubLeads = onSnapshot(collection(db, 'leads'), (snapshot) => {
      const all = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Lead));
      // Resolve target agent's department from their leads for boundary check
      const agentLeads = all.filter(
        (l) => (l as any).agentName === decodedEmail || l.assignedAgent === decodedEmail,
      );
      const resolvedDept = agentLeads[0]?.department || null;
      setTargetDept(resolvedDept);
      setLeads(agentLeads);
      setResolving(false);
      setLoading(false);
    });
    const unsubCheckins = onSnapshot(collection(db, 'checkins'), (snapshot) => {
      const all = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as CheckinItem));
      setCheckins(all.filter((c) => c.agentName === decodedEmail));
    });
    return () => {
      unsubLeads();
      unsubCheckins();
    };
  }, [decodedEmail]);

  // Department-boundary gate.
  // Admin/Chairman bypass this (they can view any agent in any department).
  // Manager-level viewers may ONLY view agents within their own department.
  if (!resolving && !isAdmin(role)) {
    const viewerDept = getDepartment(role);
    if (!targetDept || (viewerDept !== 'all' && viewerDept !== targetDept)) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground animate-fade-in-up">
          <Target className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-base font-medium">ဤ Agent ရဲ့ data ကို ကြည့်ရန် ခွင့်ပြုချက်မရှိပါ</p>
          <p className="text-xs mt-1">Department မတူညီခြင်း သို့မဟုတ် data မတွေ့ပါ</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/kpi-board')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            KPI Board သို့ ပြန်သွားရန်
          </Button>
        </div>
      );
    }
  }

  if (resolving) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const agentLeads = useMemo(
    () => leads.sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    }),
    [leads]
  );

  const agentCheckins = useMemo(
    () => checkins.sort((a, b) => {
      const aTime = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
      const bTime = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
      return bTime - aTime;
    }),
    [checkins]
  );

  const stats = useMemo(() => {
    return {
      totalLeads: agentLeads.length,
      totalCheckins: agentCheckins.length,
      levelA: agentLeads.filter((l) => l.leadLevel === 'Level A (Hot/Ready)').length,
      levelB: agentLeads.filter((l) => l.leadLevel === 'Level B (Warm/Considering)').length,
      levelC: agentLeads.filter((l) => l.leadLevel === 'Level C (Cold/Inquiring)').length,
      won: agentLeads.filter((l) => l.status === 'Success').length,
    };
  }, [agentLeads, agentCheckins]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/kpi-board')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Agent Profile</h1>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{decodedEmail}</p>
        </div>
      </div>

      {/* Stats Cards — horizontal scroll on mobile */}
      <div className="flex md:grid md:grid-cols-4 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{stats.totalLeads}</p>
              <p className="text-xs text-muted-foreground">စုစုပေါင်း Leads</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{stats.levelA}</p>
              <p className="text-xs text-muted-foreground">Level A</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <Footprints className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{stats.totalCheckins}</p>
              <p className="text-xs text-muted-foreground">Check-ins</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[140px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{stats.won}</p>
              <p className="text-xs text-muted-foreground">အောင်မြင်ရောင်းချ</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leads List */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-primary" />
            </div>
            ဤ Agent ၏ Leads စာရင်း ({stats.totalLeads})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {agentLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Users className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm font-medium">Leads မရှိသေးပါ</p>
            </div>
          ) : (
            <ScrollArea className="h-[340px] md:h-80">
              <div className="divide-y divide-border">
                {agentLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="flex items-start gap-3 p-4 min-h-[64px] transition-colors active:bg-muted/50 hover:bg-muted/30"
                  >
                    <div className="mt-0.5 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{lead.name}</p>
                        <LeadLevelBadge level={lead.leadLevel} />
                        <StatusBadge status={lead.status} color={statusColors[lead.status] || '#8FA3BF'} />
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5" />
                          {lead.phone}
                        </span>
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" />
                          {lead.preferredProject || '—'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {lead.nextFollowUpDate || '—'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/lead/${lead.id}`)}
                      className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:bg-primary/20 active:scale-95 transition-all shrink-0 mt-0.5"
                      aria-label="Lead ကြည့်ရန်"
                    >
                      <ArrowLeft className="w-4 h-4 rotate-180" />
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Check-ins List */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <Footprints className="w-4 h-4 text-success" />
            </div>
            ဤ Agent ၏ Check-ins စာရင်း ({stats.totalCheckins})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {agentCheckins.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Footprints className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm font-medium">Check-ins မရှိသေးပါ</p>
            </div>
          ) : (
            <ScrollArea className="h-[340px] md:h-80">
              <div className="divide-y divide-border">
                {agentCheckins.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 p-4 min-h-[64px] hover:bg-muted/30 transition-colors">
                    <div className="mt-0.5 w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                      <Footprints className="w-4 h-4 text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{c.project}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        {c.latitude && c.longitude && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {c.timestamp?.toDate ? c.timestamp.toDate().toLocaleDateString('en-GB') : '—'}
                        </span>
                      </div>
                    </div>
                    {c.photoURL && (
                      <img
                        src={c.photoURL}
                        alt="Check-in"
                        className="w-16 h-16 md:w-20 md:h-20 rounded-xl object-cover shrink-0 border border-border"
                      />
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
