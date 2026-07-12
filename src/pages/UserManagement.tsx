import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  User as UserIcon, Search, Filter, SlidersHorizontal, Download, FileSpreadsheet, FileText,
  Briefcase, Phone, Mail, ShieldAlert, UserPlus, Loader2, Edit2, KeyRound, Trash2,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { exportAsExcel, exportAsCSV } from '@/lib/exportUtils';
import { ROLE_TIERS, ROLE_LABELS, isExec, getDepartmentLabel, type RoleTier, type Department } from '@/lib/permissions';
import { useDepartments } from '@/hooks/useDepartments';
import type { Profile } from '@/types';
import { toast } from 'sonner';

export default function UserManagement() {
  const { role } = useAuth();
  const { departments } = useDepartments();
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<RoleTier>('sale');
  const [newDept, setNewDept] = useState<Department>('');
  const [newPassword, setNewPassword] = useState('');

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<RoleTier>('sale');
  const [editDept, setEditDept] = useState<Department>('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [resetPassword, setResetPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const canManage = isExec(role);

  useEffect(() => {
    if (!newDept && departments.length > 0) setNewDept(departments[0].code);
  }, [departments, newDept]);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('name');
      if (!active) return;
      if (error) toast.error('Could not load staff.');
      else setStaff((data || []) as Profile[]);
      setLoading(false);
    };
    load();
    const channel = supabase.channel('user-management').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => load()).subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [canManage]);

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center h-[60dvh] text-center px-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-4"><ShieldAlert className="w-8 h-8" /></div>
        <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">Staff management is restricted to Boss and Super Admin.</p>
      </div>
    );
  }

  const filteredStaff = useMemo(() => {
    return staff.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || s.name.toLowerCase().includes(q) || (s.phone || '').includes(searchQuery) || s.email.toLowerCase().includes(q);
      const matchesDept = deptFilter === 'all' || s.department_code === deptFilter;
      const matchesRole = roleFilter === 'all' || s.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchesSearch && matchesDept && matchesRole && matchesStatus;
    });
  }, [staff, searchQuery, deptFilter, roleFilter, statusFilter]);

  const exportRows = filteredStaff.map((s) => ({
    name: s.name, phone: s.phone || '', email: s.email,
    status: s.status, department: s.department_code || '', role: s.role,
  } as any));

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim() || newPassword.length < 6) {
      toast.error('Name, email, and a password of at least 6 characters are required.');
      return;
    }
    setIsSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('create-staff-user', {
        body: {
          name: newName.trim(), email: newEmail.trim().toLowerCase(), phone: newPhone.trim() || undefined,
          password: newPassword, role: newRole, department: newRole === 'boss' || newRole === 'super_admin' ? null : newDept,
        },
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not create staff account.');

      toast.success('Staff account created.');
      setNewName(''); setNewEmail(''); setNewPhone(''); setNewPassword(''); setNewRole('sale'); setNewDept(departments[0]?.code || '');
      setIsAddOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Could not create staff account.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRowClick = (s: Profile) => {
    setSelectedStaffId(s.id);
    setEditName(s.name);
    setEditPhone(s.phone || '');
    setEditRole(s.role);
    setEditDept(s.department_code || departments[0]?.code || '');
    setEditStatus(s.status);
    setResetPassword('');
    setIsEditOpen(true);
  };

  const handleResetPassword = async () => {
    if (resetPassword.length < 6) { toast.error('New password must be at least 6 characters.'); return; }
    setIsResetting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('reset-staff-password', {
        body: { userId: selectedStaffId, newPassword: resetPassword },
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not reset the password.');
      toast.success(`Password reset for ${data?.name || editName}.`);
      setResetPassword('');
    } catch (err: any) {
      toast.error(err.message || 'Could not reset the password.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleDeleteStaff = async () => {
    setIsDeleting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('delete-staff-user', {
        body: { userId: selectedStaffId },
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not delete the account.');
      toast.success(`${data?.name || editName}'s account was deleted.`);
      setDeleteConfirmOpen(false);
      setIsEditOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Could not delete the account.');
      setDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) { toast.error('Name is required.'); return; }
    setIsUpdating(true);
    const { error } = await supabase.from('profiles').update({
      name: editName.trim(), phone: editPhone.trim() || null, role: editRole,
      department_code: editRole === 'boss' || editRole === 'super_admin' ? null : editDept,
      status: editStatus,
    }).eq('id', selectedStaffId);
    setIsUpdating(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Staff profile updated.');
    setIsEditOpen(false);
  };

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground">Staff</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage and track your active staff</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={filteredStaff.length === 0} className="h-11 border-border bg-card font-medium transition-all duration-200 shrink-0 gap-2 hover:bg-muted active:scale-[0.98]">
                <Download className="w-4 h-4 text-muted-foreground" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 shadow-md rounded-lg">
              <DropdownMenuItem onClick={() => exportAsExcel(exportRows)} className="gap-2 cursor-pointer py-2 text-sm"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsCSV(exportRows)} className="gap-2 cursor-pointer py-2 text-sm"><FileText className="w-4 h-4 text-blue-600" /> CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 shadow-sm hover:shadow-md shrink-0 gap-2 active:scale-[0.98]">
                <UserPlus className="w-4 h-4" /> Add Staff
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0">
              <DialogHeader className="pb-4 border-b border-border/60">
                <DialogTitle className="text-base font-semibold flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" /> Add New Staff</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddStaff} className="space-y-4 mt-5">
                <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Name</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} required className="h-11" /></div>
                <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Email (login)</Label><Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required className="h-11" /></div>
                <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Phone</Label><Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="h-11" /></div>
                <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Password (login)</Label><Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" required className="h-11" /></div>
                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Role</Label>
                    <Select value={newRole} onValueChange={(v) => setNewRole(v as RoleTier)}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLE_TIERS.map((r) => (<SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  {/* Admin is department-scoped like Manager — department required */}
                  {newRole !== 'boss' && newRole !== 'super_admin' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Department</Label>
                      <Select value={newDept} onValueChange={(v) => setNewDept(v)}>
                        <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>{departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-5 mt-2 border-t border-border/60">
                  <DialogClose asChild><Button type="button" variant="outline" className="flex-1 h-11">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={isSaving} className="flex-1 h-11 gradient-primary text-white font-medium">{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0">
          <DialogHeader className="pb-4 border-b border-border/60">
            <DialogTitle className="text-base font-semibold flex items-center gap-2"><Edit2 className="w-4 h-4 text-primary" /> Edit Staff Profile</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateStaff} className="space-y-4 mt-5">
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} required className="h-11" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Phone</Label><Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-11" /></div>
            <div className="grid grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Role</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as RoleTier)}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLE_TIERS.map((r) => (<SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              {editRole !== 'boss' && editRole !== 'super_admin' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Department</Label>
                  <Select value={editDept} onValueChange={(v) => setEditDept(v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Status</Label>
              <Select value={editStatus} onValueChange={(v) => setEditStatus(v as 'active' | 'inactive')}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>

            {/* Password reset — exec only (this page already is), and only
                for Admin/Manager/Sales targets; the edge function enforces
                the same rule server-side so exec accounts can't be hijacked. */}
            {(editRole === 'admin' || editRole === 'manager' || editRole === 'sale') && (
              <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3.5 mt-1">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-warning" /> Reset Password
                </Label>
                <p className="text-[11px] text-muted-foreground">Sets a new login password for this staff member immediately.</p>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="New password (min 6 characters)"
                    className="h-11 flex-1"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isResetting || resetPassword.length < 6}
                    onClick={handleResetPassword}
                    className="h-11 shrink-0 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning gap-1.5"
                  >
                    {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    Reset
                  </Button>
                </div>
              </div>
            )}

            {/* Danger zone — same target rule as password reset: only
                Admin/Manager/Sales accounts, enforced server-side too. */}
            {(editRole === 'admin' || editRole === 'manager' || editRole === 'sale') && (
              <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" /> Delete Account
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Permanently removes this staff member's login, check-ins and notifications.
                  Their leads must be reassigned first.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isDeleting}
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                >
                  <Trash2 className="w-4 h-4" /> Delete this staff member
                </Button>
              </div>
            )}

            <div className="flex gap-3 pt-5 mt-2 border-t border-border/60">
              <DialogClose asChild><Button type="button" variant="outline" className="flex-1 h-11">Cancel</Button></DialogClose>
              <Button type="submit" disabled={isUpdating} className="flex-1 h-11 gradient-primary text-white font-medium">{isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => !isDeleting && setDeleteConfirmOpen(open)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {editName}'s account?</AlertDialogTitle>
            <AlertDialogDescription>
              Their login is removed permanently, along with their check-ins, notifications and
              warnings. Leads they created stay (uncredited). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => { e.preventDefault(); handleDeleteStaff(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {isDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/80" />
              <Input placeholder="Search by name, phone, or email…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 h-11 bg-muted/30 focus-visible:bg-background" />
            </div>
            <div className="flex gap-2 items-center">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" className="md:hidden flex h-11 px-3.5 gap-2 border-border">
                    <SlidersHorizontal className="w-4 h-4 text-muted-foreground" /> <span className="text-sm">Filters</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-6 pt-5 pb-8 max-h-[85dvh] overflow-y-auto">
                  <SheetHeader className="pb-4 border-b border-border/40"><SheetTitle className="text-base font-semibold flex items-center gap-2"><Filter className="w-4 h-4 text-primary" /> Filters</SheetTitle></SheetHeader>
                  <div className="space-y-4 mt-4">
                    <FilterSelect label="Department" value={deptFilter} onChange={setDeptFilter} options={[['all', 'All departments'], ...departments.map((d) => [d.code, d.name] as [string, string])]} />
                    <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter} options={[['all', 'All roles'], ...ROLE_TIERS.map((r) => [r, ROLE_LABELS[r]] as [string, string])]} />
                    <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[['all', 'All statuses'], ['active', 'Active'], ['inactive', 'Inactive']]} />
                    <SheetClose asChild><Button className="w-full h-11 font-medium mt-3">Done</Button></SheetClose>
                  </div>
                </SheetContent>
              </Sheet>
              <div className="hidden md:flex gap-2">
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card"><Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" /><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All departments</SelectItem>{departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}</SelectContent>
                </Select>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card"><UserIcon className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" /><SelectValue placeholder="Role" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All roles</SelectItem>{ROLE_TIERS.map((r) => (<SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>))}</SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card"><Briefcase className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" /><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground/90">
            <UserIcon className="w-4 h-4 text-muted-foreground/80" /> All Staff
            <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full ml-1">{filteredStaff.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full max-w-full overflow-x-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-52 gap-2 text-muted-foreground"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
            ) : filteredStaff.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-56 text-muted-foreground bg-muted/5"><ShieldAlert className="w-9 h-9 mb-2 opacity-40" /><p className="text-sm font-medium">No staff match your filters</p></div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent border-b border-border/40">
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">Name</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">Phone</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">Email</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">Department</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">Role</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.map((s) => (
                    <TableRow key={s.id} className="border-b border-border/40 transition-colors duration-150 hover:bg-muted/30 cursor-pointer" onClick={() => handleRowClick(s)}>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm font-medium text-foreground">{s.name}</TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm text-muted-foreground"><Phone className="w-3.5 h-3.5 inline mr-1.5 opacity-60" />{s.phone || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm text-muted-foreground"><Mail className="w-3.5 h-3.5 inline mr-1.5 opacity-60" />{s.email}</TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm text-foreground/80">{getDepartmentLabel(s.department_code)}</TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5 text-sm font-medium"><span className="text-xs px-2 py-0.5 font-semibold uppercase tracking-wider rounded border border-primary/20 bg-primary/5 text-primary">{ROLE_LABELS[s.role]}</span></TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-3.5">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.status === 'active' ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/20' : 'bg-destructive/5 text-destructive border-destructive/20'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'active' ? 'bg-emerald-500' : 'bg-destructive'}`} /> {s.status === 'active' ? 'Active' : 'Inactive'}
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => (<SelectItem key={v} value={v}>{l}</SelectItem>))}</SelectContent>
      </Select>
    </div>
  );
}
