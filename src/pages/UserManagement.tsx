import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, doc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isManagement, getDepartment, isAdmin, filterVisibleLeads } from '@/lib/roleUtils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  User as UserIcon, 
  Search, 
  Filter, 
  SlidersHorizontal, 
  Mic, 
  Download, 
  FileSpreadsheet, 
  FileText, 
  Briefcase, 
  Phone, 
  Mail, 
  ShieldAlert,
  UserPlus,
  Loader2,
  Edit2
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { exportAsExcel, exportAsCSV } from '@/lib/exportUtils';
import { toast } from 'sonner';

interface Salestuff {
  id: string;
  uid: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  department: string;
  status: 'Active' | 'Inactive';
}

export default function UserManagement() {
  const { role: currentLoggedUserRole } = useAuth();
    const { user, role } = useAuth();
  const [rawStaff, setRawStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Voice Search State
  const [isListening, setIsListening] = useState(false);

  // Search & Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Form states for adding new sales staff
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState('sale');
  const [newDept, setNewDept] = useState('house');
  const [newPassword, setNewPassword] = useState('');

  // Form states for modifying existing sales staff profiles
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('sale');
  const [editDept, setEditDept] = useState('house');
  const [editStatus, setEditStatus] = useState<'Active' | 'Inactive'>('Active');
  const [editPassword, setEditPassword] = useState('');

  // 🚀 CRITICAL ROUTE GUARD: Completely intercepts Sale Persons at the door.
  // They will see zero user lists, zero search fields, and zero management layouts.
  if (!isManagement(role)) {
    return (
      <div className="flex flex-col items-center justify-center h-[60dvh] text-center px-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">ဝင်ရောက်ခွင့်မရှိပါ</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">
          လူကြီးမင်းသည် ဝန်ထမ်းအချက်အလက် စီမံခန့်ခွဲမှုစာမျက်နှာအား ဝင်ရောက်ကြည့်ရှုရန် ခွင့်ပြုချက်မရှိပါ။
        </p>
      </div>
    );
  }

  // 1. Direct Firestore Snapshot Listener
  useEffect(() => {
    // Fail-safe exit condition in case the hook triggers during transitions
    if (currentLoggedUserRole === 'sale') return;

    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setRawStaff(data);
        setLoading(false);
      },
      (error) => {
        console.error("Firestore snapshot error:", error);
        toast.error("ဒေတာအသစ်များရယူရန် အဆင်မပြေဖြစ်နေပါသည်");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentLoggedUserRole]);

  // 2. Data Normalization mapping
  const staffList: Salestuff[] = useMemo(() => {
    if (!rawStaff || rawStaff.length === 0) return [];
    return rawStaff.map((s: any) => ({
      id: s.id,
      uid: s.uid || s.id,
      name: s.name || 'Unknown',
      phone: s.phone || '',
      email: s.email || '',
      role: s.role || 'sale',
      department: s.department || 'house',
      status: s.status || 'Active',
    }));
  }, [rawStaff]);

  // 3. Filter Logic Engine
  const filteredStaff = useMemo(() => {
    return staffList.filter((staff) => {
      const name = staff.name.toLowerCase();
      const phone = staff.phone;
      const email = staff.email.toLowerCase();
      const q = searchQuery.toLowerCase();

      const matchesSearch =
        !searchQuery ||
        name.includes(q) ||
        phone.includes(searchQuery) ||
        email.includes(q);
        
      const matchesDept = deptFilter === 'all' || staff.department === deptFilter;
      const matchesRole = roleFilter === 'all' || staff.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || staff.status === statusFilter;
      
      return matchesSearch && matchesDept && matchesRole && matchesStatus;
    });
  }, [staffList, searchQuery, deptFilter, roleFilter, statusFilter]);

  // 4. Registration Submission Pipeline
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (currentLoggedUserRole !== 'admin') {
      toast.error('ဤလုပ်ဆောင်ချက်ကို လုပ်ဆောင်ရန် သင့်တွင် ခွင့်ပြုချက်မရှိပါ');
      return;
    }

    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
      toast.error('အမည်၊ အီးမေးလ် နှင့် စကားဝှက်များကို အဓိကဖြည့်စွက်ပေးပါ');
      return;
    }

    setIsSaving(true);
    try {
      const staffUid = "user_" + Math.random().toString(36).substring(2, 11);
      const userDocRef = doc(db, 'users', staffUid);

      const staffData = {
        uid: staffUid,
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        phone: newPhone.trim(),
        role: newRole,
        department: newDept,
        status: 'Active',
        password: newPassword, 
        permissions: newRole === 'admin' ? ['all'] : [],
        createdAt: new Date().toISOString()
      };

      await setDoc(userDocRef, staffData);
      
      toast.success('ဝန်ထမ်းအသစ်ကို စနစ်ထဲသို့ ထည့်သွင်းပြီးပါပြီ');
      
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setNewPassword('');
      setNewRole('sale');
      setNewDept('house');
      setIsAddOpen(false);
    } catch (error) {
      console.error(error);
      toast.error('ဝန်ထမ်းအသစ်ထည့်သွင်းရာတွင် အမှားဖြစ်သွားပါသည်');
    } finally {
      setIsSaving(false);
    }
  };

  // 5. Open Profile Configuration Form
  const handleRowClick = (staff: Salestuff) => {
    const rawTarget = rawStaff.find((s) => s.id === staff.id);
    
    setSelectedStaffId(staff.id);
    setEditName(staff.name);
    setEditEmail(staff.email);
    setEditPhone(staff.phone);
    setEditRole(staff.role);
    setEditDept(staff.department);
    setEditStatus(staff.status);
    setEditPassword(rawTarget?.password || '');
    
    setIsEditOpen(true);
  };

  // 6. Push Profile Update Modifications to Firestore Collection
  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();

    if (currentLoggedUserRole !== 'admin') {
      toast.error('ပြင်ဆင်ရန် သင့်တွင် ခွင့်ပြုချက်မရှိပါ');
      return;
    }

    if (!editName.trim() || !editEmail.trim()) {
      toast.error('အမည်နှင့် အီးမေးလ် ဖြည့်စွက်ပေးရန် လိုအပ်ပါသည်');
      return;
    }

    setIsUpdating(true);
    try {
      const staffDocRef = doc(db, 'users', selectedStaffId);
      
      const updatePayload = {
        name: editName.trim(),
        email: editEmail.trim().toLowerCase(),
        phone: editPhone.trim(),
        role: editRole,
        department: editDept,
        status: editStatus,
        password: editPassword,
        permissions: editRole === 'admin' ? ['all'] : []
      };

      await updateDoc(staffDocRef, updatePayload);
      toast.success('ဝန်ထမ်းအချက်အလက်များကို ပြင်ဆင်သိမ်းဆည်းပြီးပါပြီ');
      setIsEditOpen(false);
    } catch (error) {
      console.error("Firestore field update error:", error);
      toast.error('ပြင်ဆင်မှု သိမ်းဆည်းရာတွင် အဆင်မပြေဖြစ်သွားပါသည်');
    } finally {
      setIsUpdating(false);
    }
  };

  // Voice Search Routine
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

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      {/* Top Header Action Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground">Sale Staffs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage and track your active sales team</p>
        </div>
        
        <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
          {/* Export Document Button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={filteredStaff.length === 0}
                className="h-11 border-border bg-card font-medium transition-all duration-200 shrink-0 gap-2 hover:bg-muted active:scale-[0.98]"
              >
                <Download className="w-4 h-4 text-muted-foreground" />
                ထုတ်ယူရန်
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 shadow-md rounded-lg">
              <DropdownMenuItem onClick={() => exportAsExcel(filteredStaff)} className="gap-2 cursor-pointer py-2 text-sm">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsCSV(filteredStaff)} className="gap-2 cursor-pointer py-2 text-sm">
                <FileText className="w-4 h-4 text-blue-600" /> CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Centered Add Form Dialog */}
          {currentLoggedUserRole === 'admin' && (
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button className="h-11 gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 shadow-sm hover:shadow-md shrink-0 gap-2 active:scale-[0.98]">
                  <UserPlus className="w-4 h-4" /> ဝန်ထမ်းအသစ်ထည့်ရန်
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0">
                <DialogHeader className="pb-4 border-b border-border/60">
                  <DialogTitle className="text-base font-semibold flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-primary" /> ဝန်ထမ်းအသစ်စာရင်းသွင်းရန်
                  </DialogTitle>
                </DialogHeader>
                
                <form onSubmit={handleAddStaff} className="space-y-4 mt-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-name" className="text-xs font-medium text-muted-foreground">အမည်</Label>
                    <Input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="အမည်အပြည့်အစုံထည့်ပါ" required className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-email" className="text-xs font-medium text-muted-foreground">အီးမေးလ် (လော့ဂ်အင်ဝင်ရန်)</Label>
                    <Input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="staffname@company.com" required className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-phone" className="text-xs font-medium text-muted-foreground">ဖုန်းနံပါတ်</Label>
                    <Input id="new-phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="၀၉xxxxxxxx" className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-pass" className="text-xs font-medium text-muted-foreground">စကားဝှက် (လော့ဂ်အင်ဝင်ရန်)</Label>
                    <Input id="new-pass" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="အနည်းဆုံး ဂဏန်း ၆ လုံးထည့်ပါ" required className="h-11" />
                  </div>
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">ဌာန</Label>
                      <Select value={newDept} onValueChange={(val) => setNewDept(val)}>
                        <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="house">အိမ်ရာ</SelectItem>
                          <SelectItem value="condo">ကွန်ဒို</SelectItem>
                          <SelectItem value="project">ပရောဂျက်</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">ရာထူး</Label>
                      <Select value={newRole} onValueChange={(val) => setNewRole(val)}>
                        <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="sale">Sale Person</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-5 mt-2 border-t border-border/60">
                    <DialogClose asChild>
                      <Button type="button" variant="outline" className="flex-1 h-11">မလုပ်တော့ပါ</Button>
                    </DialogClose>
                    <Button type="submit" disabled={isSaving} className="flex-1 h-11 gradient-primary text-white font-medium">
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'အတည်ပြုမည်'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Interactive Profile Management Edit Dialog Box Block */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0">
          <DialogHeader className="pb-4 border-b border-border/60">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-primary" />
              ဝန်ထမ်းအချက်အလက် စီမံခန့်ခွဲရန်
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleUpdateStaff} className="space-y-4 mt-5">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="text-xs font-medium text-muted-foreground">ဝန်ထမ်းအမည်</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} required className="h-11" disabled={currentLoggedUserRole !== 'admin'} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email" className="text-xs font-medium text-muted-foreground">အီးမေးလ်</Label>
              <Input id="edit-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required className="h-11" disabled={currentLoggedUserRole !== 'admin'} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-phone" className="text-xs font-medium text-muted-foreground">ဖုန်းနံပါတ်</Label>
              <Input id="edit-phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-11" disabled={currentLoggedUserRole !== 'admin'} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-pass" className="text-xs font-medium text-muted-foreground">စကားဝှက် ပြင်ဆင်ရန်</Label>
              <Input id="edit-pass" type="text" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} required className="h-11" disabled={currentLoggedUserRole !== 'admin'} />
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">ဌာန</Label>
                <Select value={editDept} onValueChange={(val) => setEditDept(val)} disabled={currentLoggedUserRole !== 'admin'}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="house">အိမ်ရာ</SelectItem>
                    <SelectItem value="condo">ကွန်ဒို</SelectItem>
                    <SelectItem value="project">ပရောဂျက်</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">ရာထူး</Label>
                <Select value={editRole} onValueChange={(val) => setEditRole(val)} disabled={currentLoggedUserRole !== 'admin'}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="sale">Sale Person</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Status Change Selector Block */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">အကောင့်အခြေအနေ (Status)</Label>
              <Select value={editStatus} onValueChange={(val: 'Active' | 'Inactive') => setEditStatus(val)} disabled={currentLoggedUserRole !== 'admin'}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active (ဝင်ရောက်ခွင့်ပြုမည်)</SelectItem>
                  <SelectItem value="Inactive">Inactive (ပိတ်သိမ်းမည်)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {currentLoggedUserRole === 'admin' ? (
              <div className="flex gap-3 pt-5 mt-2 border-t border-border/60">
                <DialogClose asChild>
                  <Button type="button" variant="outline" className="flex-1 h-11">မလုပ်တော့ပါ</Button>
                </DialogClose>
                <Button type="submit" disabled={isUpdating} className="flex-1 h-11 gradient-primary text-white font-medium">
                  {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'ပြင်ဆင်ချက်သိမ်းမည်'}
                </Button>
              </div>
            ) : (
              <div className="pt-3 text-center text-xs text-muted-foreground border-t border-border/40">
                အချက်အလက်များကို ပြင်ဆင်ရန် စနစ် Admin သာ ခွင့်ပြုထားပါသည်
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>

      {/* Query Control Filter Bar */}
      <Card className="shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/80" />
              <Input
                placeholder="အမည်၊ ဖုန်းနံပါတ် သို့မဟုတ် အီးမေးလ်ဖြင့် ရှာဖွေရန်..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-12 h-11 bg-muted/30 focus-visible:bg-background"
              />
              <button
                type="button"
                onClick={toggleVoiceSearch}
                className={`absolute right-2 top-1/2 -translate-y-1/2 w-7.5 h-7.5 rounded-md flex items-center justify-center transition-all ${
                  isListening ? 'bg-destructive text-white animate-pulse' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-2 items-center">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" className="md:hidden flex h-11 px-3.5 gap-2 border-border">
                    <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">စီစစ်မှုများ</span>
                    {(deptFilter !== 'all' || roleFilter !== 'all' || statusFilter !== 'all') && (
                      <span className="ml-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {[deptFilter, roleFilter, statusFilter].filter((f) => f !== 'all').length}
                      </span>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-6 pt-5 pb-8 max-h-[85dvh] overflow-y-auto">
                  <SheetHeader className="pb-4 border-b border-border/40">
                    <SheetTitle className="text-base font-semibold flex items-center gap-2">
                      <Filter className="w-4 h-4 text-primary" /> စီစစ်ခြင်း
                    </SheetTitle>
                  </SheetHeader>
                  <div className="space-y-4.5 mt-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">ဌာန</label>
                      <Select value={deptFilter} onValueChange={setDeptFilter}>
                        <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">ဌာနအားလုံး</SelectItem>
                          <SelectItem value="house">အိမ်ရာ</SelectItem>
                          <SelectItem value="condo">ကွန်ဒို</SelectItem>
                          <SelectItem value="project">ပရောဂျက်</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">ရာထူး</label>
                      <Select value={roleFilter} onValueChange={setRoleFilter}>
                        <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">ရာထူးအားလုံး</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="sale">Sale Person</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">အခြေအနေ</label>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">အခြေအနေအားလုံး</SelectItem>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <SheetClose asChild>
                      <Button className="w-full h-11 font-medium mt-3">အပြီးသတ်ရန်</Button>
                    </SheetClose>
                  </div>
                </SheetContent>
              </Sheet>

              <div className="hidden md:flex gap-2">
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card">
                    <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" />
                    <SelectValue placeholder="ဌာန" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ဌာနအားလုံး</SelectItem>
                    <SelectItem value="house">အိမ်ရာ</SelectItem>
                    <SelectItem value="condo">ကွန်ဒို</SelectItem>
                    <SelectItem value="project">ပရောဂျက်</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card">
                    <UserIcon className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" />
                    <SelectValue placeholder="ရာထူး" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ရာထူးအားလုံး</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="sale">Sale Person</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card">
                    <Briefcase className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" />
                    <SelectValue placeholder="အခြေအနေ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">အခြေအနေအားလုံး</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Table Layout Panel */}
      <Card className="shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground/90">
            <UserIcon className="w-4 h-4 text-muted-foreground/80" />
            ဝန်ထမ်းအဖွဲ့ဝင်များအားလုံး
            <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full ml-1">
              {filteredStaff.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full max-w-full overflow-x-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-52 gap-2 text-muted-foreground">
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
                <p className="text-xs">ဒေတာများ ရယူနေပါသည်...</p>
              </div>
            ) : filteredStaff.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-56 text-muted-foreground bg-muted/5">
                <ShieldAlert className="w-9 h-9 mb-2 opacity-40 text-muted-foreground" />
                <p className="text-sm font-medium">ရှာဖွေမှုနှင့် ကိုက်ညီသော ဝန်ထမ်းမတွေ့ပါ</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent border-b border-border/40">
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">အမည်</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">ဖုန်းနံပါတ်</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">အီးမေးလ်</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">ဌာန</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">ရာထူး</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">အခြေအနေ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.map((staff) => (
                    <TableRow 
                      key={staff.id} 
                      className="border-b border-border/40 transition-colors duration-150 hover:bg-muted/30 cursor-pointer" 
                      onClick={() => handleRowClick(staff)}
                    >
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm font-medium text-foreground">{staff.name}</TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm text-muted-foreground">
                        <Phone className="w-3.5 h-3.5 inline mr-1.5 opacity-60 text-foreground/70" />
                        {staff.phone || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm text-muted-foreground">
                        <Mail className="w-3.5 h-3.5 inline mr-1.5 opacity-60 text-foreground/70" />
                        {staff.email || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm text-foreground/80 capitalize">
                        {staff.department === 'house' ? 'အိမ်ရာ' : staff.department === 'condo' ? 'ကွန်ဒို' : 'ပရောဂျက်'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm font-medium">
                        <span className="text-xs px-2 py-0.5 font-semibold uppercase tracking-wider rounded border border-primary/20 bg-primary/5 text-primary">
                          {staff.role}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          staff.status === 'Active' 
                            ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/20' 
                            : 'bg-destructive/5 text-destructive border-destructive/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${staff.status === 'Active' ? 'bg-emerald-500' : 'bg-destructive'}`} />
                          {staff.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}