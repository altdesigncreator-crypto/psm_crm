import React, { useEffect, useMemo, useState, useRef } from 'react';
import { collection, addDoc, serverTimestamp, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import { MapPin, FileText, Search, Filter, Eye, Phone, Calendar, User as UserIcon, X, SlidersHorizontal, MoreVertical, PhoneCall, Navigation, Mic, Upload, Loader2, Download, FileSpreadsheet, FileCode } from 'lucide-react';
import { STATUSES, type Lead } from '@/types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getDepartment, isAdmin, filterVisibleLeads } from '@/lib/roleUtils';
import { useStatusColors } from '@/hooks/useStatusColors';
import StatusBadge from '@/components/StatusBadge';
import LeadLevelBadge from '@/components/LeadLevelBadge';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { exportAsCSV, exportAsExcel, exportAsPDF, exportAsHTML } from '@/lib/exportUtils';
import { toast } from 'sonner';

export default function Leads() {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { colors: statusColors } = useStatusColors();
  const [rawLeads, setRawLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [actionSheetLead, setActionSheetLead] = useState<Lead | null>(null);

  // Voice Search
  const [isListening, setIsListening] = useState(false);

  // Import
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
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
        console.error("Firestore snapshot error:", error);
        toast.error("ဒေတာအသစ်များရယူရန် အဆင်မပြေဖြစ်နေပါသည်");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // ✅ SAFE ROLE PROTECTION AND SORTING
  const visibleLeads = useMemo(() => {
    if (!rawLeads || rawLeads.length === 0) return [];
    
    // Pass data raw if auth state hasn't resolved roles yet so page isn't blank
    const visible = role ? filterVisibleLeads(rawLeads, role, user?.email) : rawLeads;
    
    return [...visible].sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds * 1000 || 0);
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds * 1000 || 0);
      return bTime - aTime;
    });
  }, [rawLeads, role, user?.email]);

  // ✅ DATA NORMALIZATION (Fallbacks for structural parameters)
  const leads: Lead[] = useMemo(() => {
    return visibleLeads.map((l: any) => ({
      ...l,
      name: l.name || 'Unknown',
      status: l.status || 'New',
      preferredProject: l.preferredProject || '',
      department: l.department || 'house',
      assignedAgent: l.assignedAgent || '',
      latitude: l.latitude ?? l.leadLat ?? null,
      longitude: l.longitude ?? l.leadLng ?? null,
    }));
  }, [visibleLeads]);

  const uniqueAgents = useMemo(() => {
    return Array.from(new Set(leads.map((l) => l.assignedAgent).filter(Boolean))).sort();
  }, [leads]);

  // ✅ ROBUST CONDITIONAL FILTER MATRIX
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const name = lead.name?.toLowerCase() || '';
      const agent = lead.assignedAgent?.toLowerCase() || '';
      const q = searchQuery.toLowerCase();

      const matchesSearch =
        !searchQuery ||
        name.includes(q) ||
        lead.phone?.includes(searchQuery) ||
        agent.includes(q);
        
      const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
      const matchesProject = projectFilter === 'all' || lead.preferredProject === projectFilter;
      const matchesDept = deptFilter === 'all' || lead.department === deptFilter;
      const matchesAgent = agentFilter === 'all' || lead.assignedAgent === agentFilter;
      
      return matchesSearch && matchesStatus && matchesProject && matchesDept && matchesAgent;
    });
  }, [leads, searchQuery, statusFilter, projectFilter, deptFilter, agentFilter]);

  const openMap = (lead: Lead) => {
    setSelectedLead(lead);
    setMapOpen(true);
  };

  // Voice Search handlers
  const toggleVoiceSearch = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('ဤ browser သည် voice search ကို အသုံးပြု၍မရပါ');
      return;
    }
    if (isListening) {
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'my-MM';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setSearchQuery(transcript);
      toast.info(`ရှာဖွေနေသည်: "${transcript}"`);
    };
    recognition.onerror = () => {
      setIsListening(false);
      toast.error('အသံ ရယူရာတွင် အမှားဖြစ်သွားပါသည်');
    };
    recognition.start();
  };

  // Lead Import from Excel
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) {
        toast.error('Excel ဖိုင်တွင် ဒေတာ မတွေ့ပါ');
        setImporting(false);
        return;
      }
      const headers: string[] = rows[0].map((h: any) => String(h).trim().toLowerCase());
      const findCol = (names: string[]) => {
        for (const n of names) {
          const idx = headers.findIndex((h) => h.includes(n));
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const nameIdx = findCol(['name', 'အမည်', 'ဝယ်သူ', 'customer']);
      const phoneIdx = findCol(['phone', 'ဖုန်း', 'mobile', 'tel']);
      const emailIdx = findCol(['email', 'အီးမေးလ်', 'mail']);
      const projectIdx = findCol(['project', 'ပရောဂျက်', 'preferred']);
      const statusIdx = findCol(['status', 'အခြေအနေ', 'state']);
      const levelIdx = findCol(['level', 'အဆင့်', 'grade']);
      const budgetIdx = findCol(['budget', 'ဘတ်ဂျက်', 'price']);
      const agentIdx = findCol(['agent', 'sale', 'ဝန်ထမ်း', 'person']);

      let imported = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const nameVal = nameIdx >= 0 ? String(row[nameIdx]).trim() : '';
        const phoneVal = phoneIdx >= 0 ? String(row[phoneIdx]).trim() : '';
        if (!nameVal && !phoneVal) continue;

        const leadLevel = levelIdx >= 0 ? String(row[levelIdx]).trim() : 'Level C (Cold/Inquiring)';
        const leadStatus = statusIdx >= 0 ? String(row[statusIdx]).trim() : STATUSES[0];
        const validStatus = STATUSES.includes(leadStatus) ? leadStatus : STATUSES[0];
        const validLevel = ['Level A (Hot/Ready)', 'Level B (Warm/Considering)', 'Level C (Cold/Inquiring)'].includes(leadLevel)
          ? leadLevel
          : 'Level C (Cold/Inquiring)';

        await addDoc(collection(db, 'leads'), {
          name: nameVal || 'Unknown',
          phone: phoneVal || '',
          email: emailIdx >= 0 ? String(row[emailIdx]).trim() || null : null,
          preferredProject: projectIdx >= 0 ? String(row[projectIdx]).trim() || null : null,
          status: validStatus,
          leadLevel: validLevel,
          budgetRange: budgetIdx >= 0 ? String(row[budgetIdx]).trim() || null : null,
          assignedAgent: agentIdx >= 0 ? String(row[agentIdx]).trim() || null : null,
          ownerId: user.uid,
          department: getDepartment(role),
          createdAt: serverTimestamp(),
          latitude: null,
          longitude: null,
        });
        imported++;
      }
      toast.success(`${imported} ခု Lead import အောင်မြင်ပါသည်`);
    } catch {
      toast.error('Excel import လုပ်ရာတွင် အမှားဖြစ်သွားပါသည်');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">Customer Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and track all customer leads</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportFile}
            className="hidden"
          />
          <Button
            variant="outline"
            disabled={importing}
            onClick={() => importFileRef.current?.click()}
            className="h-12 gap-2 active:scale-[0.98] transition-transform"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? 'တင်နေသည်...' : 'Import'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={filteredLeads.length === 0}
                className="h-12 gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 hover:shadow-card-hover shrink-0 gap-2 active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                ထုတ်ယူရန်
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {agentFilter !== 'all' && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1">
                  {agentFilter} · {filteredLeads.length} lead{filteredLeads.length > 1 ? 's' : ''}
                </div>
              )}
              <DropdownMenuItem
                onClick={() => {
                  toast.promise(
                    new Promise<void>((resolve) => {
                      exportAsExcel(filteredLeads);
                      resolve();
                    }),
                    { loading: 'Excel ဖိုင် ပြင်ဆင်နေသည်...', success: 'Excel ထုတ်ယူခြင်း ပြီးပါပြီ', error: 'ထုတ်ယူရာတွင် အမှားဖြစ်သွားပါသည်' }
                  );
                }}
                className="gap-2 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-success" />
                Excel
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  toast.promise(
                    new Promise<void>((resolve) => {
                      exportAsPDF(filteredLeads);
                      resolve();
                    }),
                    { loading: 'PDF ဖိုင် ပြင်ဆင်နေသည်...', success: 'PDF ထုတ်ယူခြင်း ပြီးပါပြီ', error: 'ထုတ်ယူရာတွင် အမှားဖြစ်သွားပါသည်' }
                  );
                }}
                className="gap-2 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-destructive" />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  toast.promise(
                    new Promise<void>((resolve) => {
                      exportAsHTML(filteredLeads);
                      resolve();
                    }),
                    { loading: 'HTML ဖိုင် ပြင်ဆင်နေသည်...', success: 'HTML ထုတ်ယူခြင်း ပြီးပါပြီ', error: 'ထုတ်ယူရာတွင် အမှားဖြစ်သွားပါသည်' }
                  );
                }}
                className="gap-2 cursor-pointer"
              >
                <FileCode className="w-4 h-4 text-info" />
                HTML
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  toast.promise(
                    new Promise<void>((resolve) => {
                      exportAsCSV(filteredLeads);
                      resolve();
                    }),
                    { loading: 'CSV ဖိုင် ပြင်ဆင်နေသည်...', success: 'CSV ထုတ်ယူခြင်း ပြီးပါပြီ', error: 'ထုတ်ယူရာတွင် အမှားဖြစ်သွားပါသည်' }
                  );
                }}
                className="gap-2 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-primary" />
                CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
    </div>

      {/* Search & Filters */}
      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col gap-3">
            {/* Search + Mobile Filter Trigger */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="အမည်၊ ဖုန်းနံပါတ် သို့မဟုတ် Sale Person အမည်ဖြင့် ရှာဖွေရန်..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-12 h-12"
                />
                <button
                  type="button"
                  onClick={toggleVoiceSearch}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    isListening
                      ? 'bg-destructive text-white animate-pulse'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                  title="အသံဖြင့် ရှာဖွေရန်"
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* Mobile filter button → opens bottom sheet */}
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="md:hidden flex items-center gap-1.5 px-3.5 h-12 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span className="hidden sm:inline">စီစစ်ရန်</span>
                    {(statusFilter !== 'all' || projectFilter !== 'all' || deptFilter !== 'all' || agentFilter !== 'all') && (
                      <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {[statusFilter, projectFilter, deptFilter, agentFilter].filter((f) => f !== 'all').length}
                      </span>
                    )}
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-6 pt-6 pb-8 max-h-[85dvh] overflow-y-auto">
                  <SheetHeader className="pb-4">
                    <SheetTitle className="text-base font-semibold flex items-center gap-2">
                      <Filter className="w-4 h-4 text-primary" />
                      ရှာဖွေ / စီစစ်ခြင်း
                    </SheetTitle>
                  </SheetHeader>
                  <div className="space-y-5">
                    {/* Status filter */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">အခြေအနေ</label>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="h-12 w-full">
                          <SelectValue placeholder="အခြေအနေ ရွေးချယ်ပါ" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">အခြေအနေအားလုံး</SelectItem>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Project filter */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Project</label>
                      <Select value={projectFilter} onValueChange={setProjectFilter}>
                        <SelectTrigger className="h-12 w-full">
                          <SelectValue placeholder="Project ရွေးချယ်ပါ" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Project အားလုံး</SelectItem>
                          {Array.from(new Set(leads.map((l) => l.preferredProject).filter(Boolean))).sort().map((p) => (
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Dept filter */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">ဌာန</label>
                      <Select value={deptFilter} onValueChange={setDeptFilter}>
                        <SelectTrigger className="h-12 w-full">
                          <SelectValue placeholder="ဌာန ရွေးချယ်ပါ" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">ဌာနအားလုံး</SelectItem>
                          <SelectItem value="house">အိမ်ရာ</SelectItem>
                          <SelectItem value="condo">ကွန်ဒို</SelectItem>
                          <SelectItem value="project">ပရောဂျက်</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Agent filter */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">ဝန်ထမ်း</label>
                      <Select value={agentFilter} onValueChange={setAgentFilter}>
                        <SelectTrigger className="h-12 w-full">
                          <SelectValue placeholder="ဝန်ထမ်း ရွေးချယ်ပါ" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">ဝန်ထမ်းအားလုံး</SelectItem>
                          {uniqueAgents.map((a) => (
                            <SelectItem key={a} value={a}>{a}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Active filter chips */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      {statusFilter !== 'all' && (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                          {statusFilter}
                          <button type="button" onClick={() => setStatusFilter('all')}><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {projectFilter !== 'all' && (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                          {projectFilter}
                          <button type="button" onClick={() => setProjectFilter('all')}><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {deptFilter !== 'all' && (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                          {deptFilter === 'house' ? 'အိမ်ရာ' : deptFilter === 'condo' ? 'ကွန်ဒို' : 'ပရောဂျက်'}
                          <button type="button" onClick={() => setDeptFilter('all')}><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {agentFilter !== 'all' && (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                          {agentFilter}
                          <button type="button" onClick={() => setAgentFilter('all')}><X className="w-3 h-3" /></button>
                        </span>
                      )}
                    </div>
                    <SheetClose asChild>
                      <button
                        type="button"
                        className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium text-sm transition-colors hover:bg-primary/90 active:bg-primary/80"
                      >
                        အပြီးသတ်ရန်
                      </button>
                    </SheetClose>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop inline filters */}
            <div className="hidden md:flex gap-3 shrink-0">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px] h-11">
                  <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="အခြေအနေ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">အခြေအနေအားလုံး</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-[200px] h-11">
                  <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Project အားလုံး</SelectItem>
                  {Array.from(new Set(leads.map((l) => l.preferredProject).filter(Boolean))).sort().map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="w-[140px] h-11">
                  <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="ဌာန" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ဌာနအားလုံး</SelectItem>
                  <SelectItem value="house">အိမ်ရာ</SelectItem>
                  <SelectItem value="condo">ကွန်ဒို</SelectItem>
                  <SelectItem value="project">ပရောဂျက်</SelectItem>
                </SelectContent>
              </Select>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[180px] h-11">
                  <UserIcon className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="ဝန်ထမ်း" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ဝန်ထမ်းအားလုံး</SelectItem>
                  {uniqueAgents.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Mobile active filter chips */}
            <div className="md:hidden flex flex-wrap gap-2">
              {statusFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20"
                >
                  {statusFilter}
                  <X className="w-3 h-3" />
                </button>
              )}
              {projectFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setProjectFilter('all')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20"
                >
                  {projectFilter}
                  <X className="w-3 h-3" />
                </button>
              )}
              {deptFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setDeptFilter('all')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20"
                >
                  {deptFilter === 'house' ? 'အိမ်ရာ' : deptFilter === 'condo' ? 'ကွန်ဒို' : 'ပရောဂျက်'}
                  <X className="w-3 h-3" />
                </button>
              )}
              {agentFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setAgentFilter('all')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium active:bg-primary/20"
                >
                  {agentFilter}
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile: Card List | Desktop: Table */}
      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="pb-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            Lead အားလုံး
            <span className="text-xs font-normal text-muted-foreground ml-1">({filteredLeads.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full max-w-full overflow-x-auto bg-card">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <FileText className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm font-medium">Lead မတွေ့ပါ</p>
                <p className="text-xs mt-1">ရှာဖွေခြင်း သို့မဟုတ် ရှုံးစစ်ခြင်းများကို ပြန်လည်ညှိနှိုင်းပါ</p>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="whitespace-nowrap text-xs font-semibold">အမည်</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">ဖုန်းနံပါတ်</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Project</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">ဘတ်ဂျက်</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">အဆင့်</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">အခြေအနေ</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Sale Person</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">Show Person</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">နောက်ဆက်သွယ်ရန်</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">အသံ</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">မြေပုံ</TableHead>
                        <TableHead className="whitespace-nowrap text-xs font-semibold">လုပ်ဆောင်ချက်များ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeads.map((lead) => (
                        <TableRow key={lead.id} className="transition-colors duration-300 hover:bg-muted/50" onClick={() => navigate(`/lead/${lead.id}`)}>
                          <TableCell className="whitespace-nowrap text-sm font-medium">{lead.name}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.phone || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.preferredProject || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.budgetRange || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap"><LeadLevelBadge level={lead.leadLevel} /></TableCell>
                          <TableCell className="whitespace-nowrap"><StatusBadge status={lead.status} color={statusColors?.[lead.status] || '#8FA3BF'} /></TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.assignedAgent || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.showPerson || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{lead.nextFollowUpDate || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {lead.voiceNoteURL ? (
                              <audio controls className="h-8 w-32 md:w-40"><source src={lead.voiceNoteURL} type="audio/webm" /></audio>
                            ) : (<span className="text-xs text-muted-foreground">—</span>)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {lead.latitude && lead.longitude ? (
                              <button onClick={() => openMap(lead)} className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium transition-colors">
                                <MapPin className="w-3.5 h-3.5" /> မြေပုံကြည့်ရန်
                              </button>
                            ) : (<span className="text-xs text-muted-foreground">—</span>)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-primary hover:bg-primary/5 gap-1" onClick={() => navigate(`/lead/${lead.id}`)}>
                              <Eye className="w-3.5 h-3.5" />
                              <span className="text-xs font-medium">အသေးစိတ်</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile Card List */}
                <div className="md:hidden divide-y divide-border">
                  {filteredLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="flex items-start gap-3 p-4 min-h-[72px] transition-colors hover:bg-muted/30 active:bg-muted/50"
                    >
                      <button
                        type="button"
                        onClick={() => navigate(`/lead/${lead.id}`)}
                        className="flex-1 min-w-0 space-y-2 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground truncate">{lead.name}</span>
                          <StatusBadge status={lead.status} color={statusColors?.[lead.status] || '#8FA3BF'} />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {lead.phone || '—'}
                          </span>
                          {lead.preferredProject && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {lead.preferredProject}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <LeadLevelBadge level={lead.leadLevel} />
                          {lead.assignedAgent && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <UserIcon className="w-3 h-3" />
                              {lead.assignedAgent}
                            </span>
                          )}
                        </div>
                        {lead.nextFollowUpDate && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            နောက်ဆက်သွယ်ရန်: {lead.nextFollowUpDate}
                          </div>
                        )}
                        {lead.voiceNoteURL && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <audio controls className="h-8 w-full max-w-[240px] mt-1">
                              <source src={lead.voiceNoteURL} type="audio/webm" />
                            </audio>
                          </div>
                        )}
                        {lead.latitude && lead.longitude && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openMap(lead);
                            }}
                            className="inline-flex items-center gap-1 text-xs text-primary font-medium mt-1"
                          >
                            <MapPin className="w-3 h-3" />
                            မြေပုံကြည့်ရန်
                          </button>
                        )}
                      </button>
                      {/* Mobile action trigger */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionSheetLead(lead);
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:bg-muted/50 transition-colors shrink-0 mt-0.5"
                        aria-label="လုပ်ဆောင်ချက်များ"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Map Modal */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-base font-semibold">Lead တည်နေရာ — {selectedLead?.name}</DialogTitle>
          </DialogHeader>
          {selectedLead?.latitude && selectedLead?.longitude && (
            <div className="px-6 pb-6">
              <p className="text-sm text-muted-foreground mb-3">
                Lat: {Number(selectedLead.latitude).toFixed(5)}, Lng: {Number(selectedLead.longitude).toFixed(5)}
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
                  src={`http://googleusercontent.com/maps.google.com/maps?q=${selectedLead.latitude},${selectedLead.longitude}&zoom=15&output=embed`}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mobile Lead Action Bottom Sheet */}
      <Sheet open={!!actionSheetLead} onOpenChange={(open) => !open && setActionSheetLead(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-0 pt-0 pb-8 max-h-[60dvh]">
          {actionSheetLead && (
            <div className="space-y-1">
              {/* Header */}
              <div className="px-6 pt-5 pb-3 border-b border-border">
                <p className="text-base font-semibold text-foreground truncate">{actionSheetLead.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{actionSheetLead.phone || 'ဖုန်းနံပါတ်မရှိပါ'}</p>
              </div>
              {/* Actions */}
              <div className="px-2 py-2 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setActionSheetLead(null);
                    navigate(`/lead/${actionSheetLead.id}`);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Eye className="w-4 h-4 text-primary" />
                  </div>
                  အသေးစိတ်ကြည့်ရန်
                </button>
                {actionSheetLead.phone && (
                  <a
                    href={`tel:${actionSheetLead.phone}`}
                    onClick={() => setActionSheetLead(null)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                      <PhoneCall className="w-4 h-4 text-success" />
                    </div>
                    ဖုန်းဆက်သွယ်ရန်
                  </a>
                )}
                {actionSheetLead.latitude && actionSheetLead.longitude && (
                  <button
                    type="button"
                    onClick={() => {
                      openMap(actionSheetLead);
                      setActionSheetLead(null);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center shrink-0">
                      <Navigation className="w-4 h-4 text-info" />
                    </div>
                    တည်နေရာ ကြည့်ရန်
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActionSheetLead(null)}
                  className="w-full flex items-center justify-center px-4 py-3.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/50 active:bg-muted transition-colors border border-border"
                >
                  ပိတ်ရန်
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}