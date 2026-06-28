// src/pages/RoleManagement.tsx

import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Shield, Plus, KeyRound, Loader2, Save, CheckSquare, Square, ShieldCheck,ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Permission, ROLE_PRESETS, SYSTEM_PERMISSIONS, RoleConfig } from '@/config/permissions';
import { isManagement, getDepartment, isAdmin, filterVisibleLeads } from '@/lib/roleUtils';
import { useAuth } from '@/contexts/AuthContext';

interface RoleData {
  id: string;        // Document ID (e.g., 'admin', 'manager', 'custom_role')
  name: string;      // Display name (e.g., 'System Administrator')
  permissions: Permission[];
}

export default function RoleManagement() {
  
    const { role: currentLoggedUserRole } = useAuth();
    const { user, role } = useAuth();
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  
  // New Role Creation State variables
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newRoleId, setNewRoleId] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [isSavingNew, setIsSavingNew] = useState(false);
  
  // Right side panel synchronization pipeline state variable
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);

  // Locate our currently active role focus target container details reference
  const selectedRole = roles.find(r => r.id === selectedRoleId) || null;
  if (!isManagement(role)) {
    return (
      <div className="flex flex-col items-center justify-center h-[60dvh] text-center px-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">ဝင်ရောက်ခွင့်မရှိပါ</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">
          လူကြီးမင်းသည် ရာထူးနှင့်လုပ်ပိုင်ခွင့်များ စီမံခန့်ခွဲမှုစာမျက်နှာအား ဝင်ရောက်ကြည့်ရှုရန် ခွင့်ပြုချက်မရှိပါ။
        </p>
      </div>
    );
  }
  // 1. Listen for real-time changes inside the 'roles' document collection reference
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'roles'),
      (snapshot) => {
        if (snapshot.empty) {
          // If Firestore roles group is uninitialized, populate defaults down into storage collection automatically
          initializeDefaultPresets();
        } else {
          const list = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as RoleData[];
          setRoles(list);
          if (!selectedRoleId && list.length > 0) {
            setSelectedRoleId(list[0].id); // Auto focus onto first role preset configuration
          }
        }
        setLoading(false);
      },
      (error) => {
        console.error("Firestore listening error within Role Configuration Matrix:", error);
        toast.error("ခွင့်ပြုချက် ရာထူးဒေတာများ ရယူရန် အဆင်မပြေဖြစ်နေပါသည်");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [selectedRoleId]);
  

  // Seeding engine subroutine to inject raw code matrix values onto remote firestore configurations
  const initializeDefaultPresets = async () => {
    try {
      for (const [key, val] of Object.entries(ROLE_PRESETS)) {
        await setDoc(doc(db, 'roles', key), {
          name: val.name,
          permissions: val.permissions
        });
      }
    } catch (err) {
      console.error("Error running auto seed routine sequence on fallback records:", err);
    }
  };

  // 2. Add New Custom Role Profile Record Pipeline Trigger Routine
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentLoggedUserRole !== 'admin') {
      toast.error('ဤလုပ်ဆောင်ချက်ကို လုပ်ဆောင်ရန် သင့်တွင် ခွင့်ပြုချက်မရှိပါ');
      return;
    }

    const formattedId = newRoleId.trim().toLowerCase().replace(/\s+/g, '_');
    if (!formattedId || !newRoleName.trim()) {
      toast.error('ကုဒ်နံပါတ် နှင့် ရာထူးအမည် အပြည့်အစုံ ဖြည့်စွက်ပေးရန် လိုအပ်ပါသည်');
      return;
    }

    if (roles.some(r => r.id === formattedId)) {
      toast.error('ဤရာထူး ကုဒ်နံပါတ်သည် စနစ်ထဲတွင် ရှိနှင့်ပြီးသား ဖြစ်နေပါသည်');
      return;
    }

    setIsSavingNew(true);
    try {
      await setDoc(doc(db, 'roles', formattedId), {
        name: newRoleName.trim(),
        permissions: ['view_dashboard'] // Default with baseline access permission
      });
      
      toast.success('ရာထူးအသစ်ကို စနစ်ထဲသို့ ထည့်သွင်းသတ်မှတ်ပြီးပါပြီ');
      setSelectedRoleId(formattedId);
      setNewRoleId('');
      setNewRoleName('');
      setIsCreateOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('ရာထူးအသစ် ဖန်တီးရာတွင် အမှားဖြစ်သွားပါသည်');
    } finally {
      setIsSavingNew(false);
    }
  };

  // 3. Toggle single permission rule inside memory profile arrays state variable hook tracker 
  const handleTogglePermission = async (permissionId: Permission) => {
    if (currentLoggedUserRole !== 'admin') {
      toast.error('ခွင့်ပြုချက် မွမ်းမံမှုများကို Admin သာ လုပ်ဆောင်ပိုင်ခွင့်ရှိသည်');
      return;
    }
    if (!selectedRole) return;

    const exists = selectedRole.permissions.includes(permissionId);
    const updatedPermissions = exists
      ? selectedRole.permissions.filter(p => p !== permissionId)
      : [...selectedRole.permissions, permissionId];

    // Optimistic state evaluation UI update
    setRoles(prev => prev.map(r => r.id === selectedRole.id ? { ...r, permissions: updatedPermissions } : r));

    setIsSavingPermissions(true);
    try {
      await updateDoc(doc(db, 'roles', selectedRole.id), {
        permissions: updatedPermissions
      });
      toast.success(`"${SYSTEM_PERMISSIONS.find(p => p.id === permissionId)?.label}" အခြေအနေ ပြောင်းလဲပြီးပါပြီ`);
    } catch (err) {
      console.error("Failed to persist permission flag mutation sequence onto Firestore:", err);
      toast.error('ပြင်ဆင်ချက်ကို ဒေတာဘေ့စ်တွင် သိမ်းဆည်းရန် မအောင်မြင်ပါ');
      // Revert optimization on failure state fallback loop
      setRoles(prev => prev.map(r => r.id === selectedRole.id ? { ...r, permissions: selectedRole.permissions } : r));
    } finally {
      setIsSavingPermissions(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      {/* Top Main Bar Header Block Component Setup */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground">Role Permissions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure access control levels and modular matrices permissions</p>
        </div>

        {currentLoggedUserRole === 'admin' && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 gradient-primary text-white gap-2 font-medium transition-all shadow-sm duration-200 active:scale-[0.98]">
                <Plus className="w-4 h-4" />
                ရာထူးအသစ်သတ်မှတ်ရန်
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card">
              <DialogHeader className="pb-3 border-b border-border/60">
                <DialogTitle className="text-base font-semibold flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  စနစ်သုံး ရာထူးအဆင့်အသစ် ထည့်သွင်းရန်
                </DialogTitle>
                <DialogDescription className="text-xs pt-1">
                  စနစ်တွင်း အသုံးပြုမည့် ရာထူးအုပ်စု အသစ်ကို ဖန်တီးသတ်မှတ်ပါ။
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreateRole} className="space-y-4.5 mt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="role-id" className="text-xs font-medium text-muted-foreground">ရာထူး ကုဒ်အမည် (ID Key)</Label>
                  <Input id="role-id" value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)} placeholder="ဥပမာ - super_agent" required className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role-name" className="text-xs font-medium text-muted-foreground">ပြသရန်အမည် (Display Name)</Label>
                  <Input id="role-name" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="ဥပမာ - Senior Sales Consultant" required className="h-11" />
                </div>

                <div className="flex gap-3 pt-4 border-t border-border/60">
                  <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setIsCreateOpen(false)}>မလုပ်တော့ပါ</Button>
                  <Button type="submit" disabled={isSavingNew} className="flex-1 h-11 gradient-primary text-white font-medium">
                    {isSavingNew ? <Loader2 className="w-4 h-4 animate-spin" /> : 'အတည်ပြုမည်'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
          <p className="text-xs">ခွင့်ပြုချက် မက်ထရစ်များ ထုတ်ယူနေပါသည်...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Columns Pane Side Sheet Table Block */}
          <Card className="lg:col-span-5 shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden h-fit">
            <CardHeader className="px-5 py-4 border-b border-border/40 bg-muted/10">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                ရရှိနိုင်သော စနစ်ရာထူးများ ({roles.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent border-b border-border/40">
                    <TableHead className="px-5 h-11 text-xs font-semibold text-muted-foreground">ရာထူးအမည်</TableHead>
                    <TableHead className="px-5 h-11 text-xs font-semibold text-muted-foreground text-center">ခွင့်ပြုချက် အရေအတွက်</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((roleItem) => (
                    <TableRow
                      key={roleItem.id}
                      onClick={() => setSelectedRoleId(roleItem.id)}
                      className={`border-b border-border/40 transition-all cursor-pointer ${
                        selectedRoleId === roleItem.id ? 'bg-primary/5 hover:bg-primary/10 font-medium' : 'hover:bg-muted/40'
                      }`}
                    >
                      <TableCell className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-2 h-2 rounded-full ${selectedRoleId === roleItem.id ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                          <div>
                            <p className="text-sm text-foreground">{roleItem.name}</p>
                            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{roleItem.id}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-center">
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full border bg-muted text-muted-foreground">
                          {roleItem.permissions.length} ခု ခွင့်ပြုထား
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Right Columns Management Checklist Detail Module Grid Sheet */}
          <Card className="lg:col-span-7 shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
            {selectedRole ? (
              <>
                <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10 flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-base font-semibold text-foreground flex items-center gap-1.5">
                      <KeyRound className="w-4 h-4 text-primary" />
                      {selectedRole.name} ၏ အခွင့်အာဏာ စီမံချက်များ
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      အကွက်များကို နှိပ်၍ သက်ဆိုင်ရာ လုပ်ဆောင်ခွင့် ကန့်သတ်ချက်များကို ပြောင်းလဲပါ။
                    </CardDescription>
                  </div>
                  {isSavingPermissions && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                  )}
                </CardHeader>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 gap-3">
                    {SYSTEM_PERMISSIONS.map((perm) => {
                      const isGranted = selectedRole.permissions.includes(perm.id);
                      return (
                        <div
                          key={perm.id}
                          onClick={() => handleTogglePermission(perm.id)}
                          className={`flex items-start justify-between gap-4 p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                            isGranted 
                              ? 'bg-primary/[0.02] border-primary/30 shadow-sm' 
                              : 'border-border/60 hover:bg-muted/30'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                              isGranted ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                            }`}>
                              {perm.id}
                            </span>
                            <p className="text-sm font-semibold text-foreground mt-2">{perm.label}</p>
                            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{perm.description}</p>
                          </div>
                          <div className="pt-1.5 shrink-0 select-none">
                            {isGranted ? (
                              <div className="w-5 h-5 rounded border-transparent bg-primary flex items-center justify-center text-white shadow-sm transition-all">
                                <CheckSquare className="w-4 h-4" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded border-2 border-muted-foreground/30 flex items-center justify-center text-transparent hover:border-muted-foreground/60 transition-all">
                                <Square className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Shield className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm font-medium">ပြင်ဆင်ရန် ရာထူးတစ်ခု ရွေးချယ်ပါ</p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}