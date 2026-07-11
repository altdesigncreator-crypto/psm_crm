import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LEAD_STAGES, type Lead, type LeadStage } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useStatusColors } from '@/hooks/useStatusColors';
import { useProfiles } from '@/hooks/useProfiles';
import { canEditLead } from '@/lib/permissions';
import LeadLevelBadge from '@/components/LeadLevelBadge';
import { Phone, MapPin, DollarSign, User, ArrowRight, ArrowLeft, Eye, MoveRight, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface PipelineColumn {
  status: LeadStage;
  label: string;
  leads: Lead[];
}

// All stages are shown as board columns, including Lost. But Lost is a
// branch off the happy path (reached from any stage, not a forward step),
// so it's excluded from the quick forward/backward buttons — those only
// walk the sequential "happy path". Sold is terminal: once there, a lead
// can't move to any other stage (enforced in the DB too, see crm.sql).
const ALL_STAGE_VALUES: LeadStage[] = LEAD_STAGES.map((s) => s.value);
const FORWARD_STAGE_VALUES: LeadStage[] = ALL_STAGE_VALUES.filter((s) => s !== 'lost');

export default function PipelineBoard() {
  const navigate = useNavigate();
  const { user, role, department } = useAuth();
  const { colors: statusColors } = useStatusColors();
  const { nameOf } = useProfiles();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from('leads').select('*');
      if (!active) return;
      if (error) toast.error('Could not load the pipeline.');
      else setLeads((data || []) as Lead[]);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel('pipeline-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const currentUser = user ? { id: user.id, role, department } : null;

  const columns: PipelineColumn[] = useMemo(() => {
    return ALL_STAGE_VALUES.map((status) => ({
      status,
      label: LEAD_STAGES.find((s) => s.value === status)!.label,
      leads: leads.filter((l) => l.status === status),
    }));
  }, [leads]);

  const handleMoveLead = async (leadId: string, newStatus: string, currentStatus?: string) => {
    if (currentStatus === 'sold') {
      toast.error('This lead is Sold — its stage can no longer be changed.');
      return;
    }
    setMoving(true);
    const { error } = await supabase.from('leads').update({ status: newStatus }).eq('id', leadId);
    setMoving(false);
    if (error) {
      toast.error(error.message.includes('Sold') ? error.message : 'Could not update the lead stage.');
      return;
    }
    toast.success(`Lead moved to ${LEAD_STAGES.find((s) => s.value === newStatus)?.label}.`);
    setMoveDialogOpen(false);
    setSelectedLead(null);
  };

  const openMoveDialog = (lead: Lead) => { setSelectedLead(lead); setMoveDialogOpen(true); };

  const getStageIndex = (status: string) => FORWARD_STAGE_VALUES.indexOf(status as LeadStage);
  const canMoveForward = (status: string) => status !== 'sold' && getStageIndex(status) >= 0 && getStageIndex(status) < FORWARD_STAGE_VALUES.length - 1;
  const canMoveBackward = (status: string) => status !== 'sold' && getStageIndex(status) > 0;
  const getNextStatus = (status: string) => FORWARD_STAGE_VALUES[getStageIndex(status) + 1];
  const getPrevStatus = (status: string) => FORWARD_STAGE_VALUES[getStageIndex(status) - 1];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Lead Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">Stage-based lead tracking board</p>
        </div>
        <span className="text-sm text-muted-foreground shrink-0">Total: {leads.length} leads</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
        {columns.map((col) => {
          const fallbackColor = '#0463CA';
          const columnColor = statusColors[col.status] || fallbackColor;

          return (
            <div key={col.status} className="flex flex-col gap-3 bg-muted/30 p-3 rounded-2xl border border-border/40">
              <div
                className="flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-200 shadow-sm"
                style={{ borderColor: `${columnColor}40`, backgroundColor: `${columnColor}10` }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: columnColor }} />
                  <span className="text-sm font-semibold truncate" style={{ color: columnColor }}>{col.label}</span>
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-background px-2 py-0.5 rounded-full border shadow-sm shrink-0">{col.leads.length}</span>
              </div>

              <div className="flex flex-col gap-2.5 max-h-[70vh] overflow-y-auto pr-0.5 custom-scrollbar">
                {col.leads.map((lead) => {
                  const editable = canEditLead(currentUser, { ownerId: lead.owner_id, departmentCode: lead.department_code }) && lead.status !== 'sold';
                  return (
                    <Card
                      key={lead.id}
                      className="shadow-sm rounded-xl border border-border/60 hover:border-primary/30 hover:shadow-card transition-all duration-200 cursor-pointer active:scale-[0.99] bg-card"
                      onClick={() => navigate(`/lead/${lead.id}`)}
                    >
                      <CardContent className="p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground truncate">{lead.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {lead.status === 'sold' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20" title="Sold — stage is locked">
                                <Lock className="w-2.5 h-2.5" /> Locked
                              </span>
                            )}
                            <LeadLevelBadge grade={lead.lead_grade} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.phone}</span>
                        </div>
                        {lead.preferred_project && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.preferred_project}</span>
                          </div>
                        )}
                        {lead.budget_range && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <DollarSign className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.budget_range}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="w-3 h-3 shrink-0" /> <span className="truncate">{nameOf(lead.owner_id)}</span>
                        </div>

                        <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/40">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); navigate(`/lead/${lead.id}`); }}
                            className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-primary/5 text-primary text-xs font-medium hover:bg-primary/10 active:bg-primary/15 transition-colors"
                          >
                            <Eye className="w-3 h-3" /> View
                          </button>
                          {editable && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openMoveDialog(lead); }}
                              className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 active:bg-muted/60 transition-colors"
                            >
                              <MoveRight className="w-3 h-3" /> Move
                            </button>
                          )}
                        </div>

                        {editable && (
                          <div className="flex items-center gap-1 pt-0.5">
                            {canMoveBackward(lead.status) && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleMoveLead(lead.id, getPrevStatus(lead.status), lead.status); }}
                                disabled={moving}
                                className="h-7 px-2 rounded-md border border-border/60 text-xs text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors disabled:opacity-40 flex items-center gap-0.5"
                              >
                                <ArrowLeft className="w-3 h-3" /> {LEAD_STAGES.find((s) => s.value === getPrevStatus(lead.status))?.label}
                              </button>
                            )}
                            {canMoveForward(lead.status) && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleMoveLead(lead.id, getNextStatus(lead.status), lead.status); }}
                                disabled={moving}
                                className="h-7 px-2 rounded-md border text-xs flex items-center gap-0.5 ml-auto transition-colors disabled:opacity-40"
                                style={{
                                  borderColor: `${statusColors[getNextStatus(lead.status)] || fallbackColor}40`,
                                  color: statusColors[getNextStatus(lead.status)] || fallbackColor,
                                  backgroundColor: `${statusColors[getNextStatus(lead.status)] || fallbackColor}08`,
                                }}
                              >
                                {LEAD_STAGES.find((s) => s.value === getNextStatus(lead.status))?.label} <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}

                {col.leads.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed border-border/40 rounded-xl bg-background/50">
                    No leads
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Move Lead Stage</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Move <span className="font-semibold text-foreground">{selectedLead?.name}</span> to which stage?
            </p>
            <Select
              value={selectedLead?.status || ''}
              disabled={selectedLead?.status === 'sold'}
              onValueChange={(v) => { if (selectedLead && v !== selectedLead.status) handleMoveLead(selectedLead.id, v, selectedLead.status); }}
            >
              <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Select stage" /></SelectTrigger>
              <SelectContent className="rounded-xl">
                {LEAD_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColors[s.value] || '#8FA3BF' }} />
                      <span className="text-sm font-medium">{s.label}</span>
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
