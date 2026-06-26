import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/contexts/TranslationContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  MapPin,
  Search,
  Navigation,
  Filter,
  Phone,
  User,
  Eye,
  X,
  Globe,
} from 'lucide-react';
import { STATUSES } from '@/types';

interface LeadWithGPS {
  id: string;
  name: string;
  phone: string;
  status: string;
  assignedAgent: string;
  department?: string;
  preferredProject: string;
  leadLat?: number;
  leadLng?: number;
  currentLocation?: string;
  budgetMin?: number;
  budgetMax?: number;
}

export default function LeadMap() {
  const { t } = useTranslation();
  const [leads, setLeads] = useState<LeadWithGPS[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [selectedLead, setSelectedLead] = useState<LeadWithGPS | null>(null);
  const [mapSrc, setMapSrc] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'leads'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: (raw.name as string) || '',
          phone: (raw.phone as string) || '',
          status: (raw.status as string) || '',
          assignedAgent: (raw.assignedAgent as string) || '',
          department: (raw.department as string) || '',
          preferredProject: (raw.preferredProject as string) || '',
          leadLat: raw.leadLat != null ? Number(raw.leadLat) : undefined,
          leadLng: raw.leadLng != null ? Number(raw.leadLng) : undefined,
          currentLocation: (raw.currentLocation as string) || '',
          budgetMin: raw.budgetMin != null ? Number(raw.budgetMin) : undefined,
          budgetMax: raw.budgetMax != null ? Number(raw.budgetMax) : undefined,
        };
      });
      setLeads(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const agents = useMemo(() => {
    const set = new Set(leads.map((l) => l.assignedAgent).filter(Boolean));
    return Array.from(set).sort();
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch =
        !search ||
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        l.phone.includes(search) ||
        l.preferredProject.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
      const matchesAgent = agentFilter === 'all' || l.assignedAgent === agentFilter;
      return matchesSearch && matchesStatus && matchesAgent;
    });
  }, [leads, search, statusFilter, agentFilter]);

  const leadsWithGPS = useMemo(
    () => filteredLeads.filter((l) => l.leadLat != null && l.leadLng != null),
    [filteredLeads]
  );

  useEffect(() => {
    if (selectedLead && selectedLead.leadLat && selectedLead.leadLng) {
      setMapSrc(
        `https://www.google.com/maps/embed/v1/place?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&q=${selectedLead.leadLat},${selectedLead.leadLng}&language=en&region=cn&zoom=15`
      );
    } else if (leadsWithGPS.length > 0) {
      // Default to first lead with GPS
      const first = leadsWithGPS[0];
      setMapSrc(
        `https://www.google.com/maps/embed/v1/place?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&q=${first.leadLat},${first.leadLng}&language=en&region=cn&zoom=14`
      );
    } else {
      // Default to Yangon
      setMapSrc(
        `https://www.google.com/maps/embed/v1/view?key=AIzaSyB_LJOYJL-84SMuxNB7LtRGhxEQLjswvy0&center=16.8661,96.1951&zoom=12&language=en&region=cn`
      );
    }
  }, [selectedLead, leadsWithGPS]);

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      'New': 'bg-info/10 text-info border-info/20',
      'Contacted': 'bg-warning/10 text-warning border-warning/20',
      'Interested': 'bg-success/10 text-success border-success/20',
      'Negotiation': 'bg-primary/10 text-primary border-primary/20',
      'Closed': 'bg-success/10 text-success border-success/20',
      'Lost': 'bg-destructive/10 text-destructive border-destructive/20',
    };
    return colors[status] || 'bg-muted text-muted-foreground border-border';
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-5 h-[calc(100dvh-64px)] animate-fade-in-up">
      {/* Sidebar — Lead List */}
      <div className="w-full md:w-80 lg:w-96 flex flex-col gap-3 shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug flex items-center gap-2">
            <Globe className="w-6 h-6 text-primary" />
            {t('map.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('common.total')} {filteredLeads.length} · GPS {leadsWithGPS.length}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 text-xs flex-1">
                <SelectValue placeholder={t('common.status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-10 text-xs flex-1">
                <SelectValue placeholder={t('common.agent')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Lead List */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <MapPin className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">{t('common.noData')}</p>
            </div>
          ) : (
            filteredLeads.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => setSelectedLead(lead)}
                className={`w-full text-left p-3 rounded-xl border transition-all active:scale-[0.99] ${
                  selectedLead?.id === lead.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:border-primary/30 hover:bg-primary/5'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{lead.name || '—'}</p>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                      <Phone className="w-3 h-3" />
                      <span>{lead.phone || '—'}</span>
                    </div>
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${statusBadge(lead.status)}`}>
                    {lead.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {lead.assignedAgent || '—'}
                  </span>
                  {lead.leadLat != null ? (
                    <span className="flex items-center gap-1 text-success">
                      <Navigation className="w-3 h-3" />
                      GPS
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground/60">
                      <MapPin className="w-3 h-3" />
                      {t('map.gpsMissing')}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {selectedLead && (
          <Card className="shadow-card rounded-xl border-0 shrink-0">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-bold text-foreground">{selectedLead.name}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusBadge(selectedLead.status)}`}>
                      {selectedLead.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" />
                      {selectedLead.phone}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5" />
                      {selectedLead.assignedAgent || '—'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedLead.preferredProject}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setSelectedLead(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-border bg-card">
          {mapSrc ? (
            <iframe
              title={t('map.title')}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              referrerPolicy="no-referrer-when-downgrade"
              src={mapSrc}
              allowFullScreen
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <MapPin className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">{t('map.selectLead')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
