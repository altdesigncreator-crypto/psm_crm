import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { STATUSES, type Lead } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useStatusColors } from '@/hooks/useStatusColors';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import { Phone, MapPin, DollarSign, User, ArrowRight, ArrowLeft, Eye, MoveRight } from 'lucide-react';
import { filterVisibleLeads } from '@/lib/roleUtils';
import { toast } from 'sonner';

interface PipelineColumn {
  status: string;
  label: string;
  leads: Lead[];
}

export default function PipelineBoard() {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { colors: statusColors } = useStatusColors();
  
  const [rawLeads, setRawLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  // ✅ REAL-TIME SNAPSHOT SYNC WITH FIREBASE
  useEffect(() => {
    const q = query(collection(db, 'leads'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setRawLeads(data);
        setLoading(false);
      },
      (error) => {
        console.error("Pipeline database listener error:", error);
        toast.error("ဒေတာအသစ်များ ရယူရန် အဆင်မပြေဖြစ်နေပါသည်");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // ✅ DEFENSIBLY FILTER LEADS BASED ON ROLE MATRIX ACCESS
  const leads: Lead[] = useMemo(() => {
    if (!rawLeads || rawLeads.length === 0) return [];
    return role ? filterVisibleLeads(rawLeads, role, user?.email) : rawLeads;
  }, [rawLeads, role, user?.email]);

  const columns: PipelineColumn[] = useMemo(() => {
    return STATUSES.map((status) => ({
      status,
      label: status,
      leads: leads.filter((l) => l.status === status),
    }));
  }, [leads]);

  const handleMoveLead = async (leadId: string, newStatus: string) => {
    setMoving(true);
    try {
      await updateDoc(doc(db, 'leads', leadId), { status: newStatus });
      toast.success(`Lead ကို ${newStatus} သို့ ပြောင်းပြီးပါပြီ`);
      setMoveDialogOpen(false);
      setSelectedLead(null);
    } catch (error) {
      console.error(error);
      toast.error('Lead status ပြောင်းရာတွင် အမှားဖြစ်သွားပါသည်');
    } finally {
      setMoving(false);
    }
  };

  const openMoveDialog = (lead: Lead) => {
    setSelectedLead(lead);
    setMoveDialogOpen(true);
  };

  const getStageIndex = (status: string) => STATUSES.indexOf(status);

  const canMoveForward = (status: string) => getStageIndex(status) < STATUSES.length - 1;
  const canMoveBackward = (status: string) => getStageIndex(status) > 0;

  const getNextStatus = (status: string) => STATUSES[getStageIndex(status) + 1];
  const getPrevStatus = (status: string) => STATUSES[getStageIndex(status) - 1];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Lead Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">Stage-based lead tracking board</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">စုစုပေါင်း: {leads.length} Leads</span>
        </div>
      </div>

      {/* Pipeline Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
        {columns.map((col) => {
          const fallbackColor = '#0463CA';
          const columnColor = statusColors[col.status] || fallbackColor;

          return (
            <div key={col.status} className="flex flex-col gap-3 bg-muted/30 p-3 rounded-2xl border border-border/40">
              {/* Column Header */}
              <div
                className="flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-200 shadow-sm"
                style={{
                  borderColor: `${columnColor}40`,
                  backgroundColor: `${columnColor}10`,
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: columnColor }}
                  />
                  <span className="text-sm font-semibold truncate" style={{ color: columnColor }}>
                    {col.label}
                  </span>
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-background px-2 py-0.5 rounded-full border shadow-sm shrink-0">
                  {col.leads.length}
                </span>
              </div>

              {/* Lead Cards Container */}
              <div className="flex flex-col gap-2.5 max-h-[70vh] overflow-y-auto pr-0.5 custom-scrollbar">
                {col.leads.map((lead) => (
                  <Card
                    key={lead.id}
                    className="shadow-sm rounded-xl border border-border/60 hover:border-primary/30 hover:shadow-card transition-all duration-200 cursor-pointer active:scale-[0.99] bg-card"
                    onClick={() => navigate(`/lead/${lead.id}`)}
                  >
                    <CardContent className="p-3.5 space-y-2.5">
                      {/* Name & Level */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground truncate">
                          {lead.name}
                        </span>
                        <LeadLevelBadge level={lead.leadLevel} />
                      </div>

                      {/* Phone */}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span className="truncate">{lead.phone}</span>
                      </div>

                      {/* Project */}
                      {lead.preferredProject && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{lead.preferredProject}</span>
                        </div>
                      )}

                      {/* Budget */}
                      {lead.budgetRange && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <DollarSign className="w-3 h-3 shrink-0" />
                          <span className="truncate">{lead.budgetRange}</span>
                        </div>
                      )}

                      {/* Assigned Agent */}
                      {lead.assignedAgent && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="w-3 h-3 shrink-0" />
                          <span className="truncate">{lead.assignedAgent}</span>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/40">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/lead/${lead.id}`);
                          }}
                          className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-primary/5 text-primary text-xs font-medium hover:bg-primary/10 active:bg-primary/15 transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          ကြည့်ရန်
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openMoveDialog(lead);
                          }}
                          className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 active:bg-muted/60 transition-colors"
                        >
                          <MoveRight className="w-3 h-3" />
                          ရွှေ့ရန်
                        </button>
                      </div>

                      {/* Quick Stage Move Footer */}
                      <div className="flex items-center gap-1 pt-0.5">
                        {canMoveBackward(lead.status) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveLead(lead.id, getPrevStatus(lead.status));
                            }}
                            disabled={moving}
                            className="h-7 px-2 rounded-md border border-border/60 text-xs text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors disabled:opacity-40 flex items-center gap-0.5"
                          >
                            <ArrowLeft className="w-3 h-3" />
                            {getPrevStatus(lead.status)}
                          </button>
                        )}
                        {canMoveForward(lead.status) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveLead(lead.id, getNextStatus(lead.status));
                            }}
                            disabled={moving}
                            className="h-7 px-2 rounded-md border text-xs flex items-center gap-0.5 ml-auto transition-colors disabled:opacity-40"
                            style={{
                              borderColor: `${statusColors[getNextStatus(lead.status)] || fallbackColor}40`,
                              color: statusColors[getNextStatus(lead.status)] || fallbackColor,
                              backgroundColor: `${statusColors[getNextStatus(lead.status)] || fallbackColor}08`,
                            }}
                          >
                            {getNextStatus(lead.status)}
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {col.leads.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed border-border/40 rounded-xl bg-background/50">
                    Lead မရှိပါ
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Move Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Lead Status ပြောင်းရန်</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">{selectedLead?.name}</span> ကို မည့် stage သို့ ရွှေ့မည်လဲ။
            </p>
            <Select
              value={selectedLead?.status || ''}
              onValueChange={(v) => {
                if (selectedLead && v !== selectedLead.status) {
                  handleMoveLead(selectedLead.id, v);
                }
              }}
            >
              <SelectTrigger className="h-12 rounded-xl">
                <SelectValue placeholder="Stage ရွေးချယ်ပါ" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="rounded-lg">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: statusColors[s] || '#8FA3BF' }}
                      />
                      <span className="text-sm font-medium">{s}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}