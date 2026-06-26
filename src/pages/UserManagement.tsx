import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  doc,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import { createFirebaseUser } from '@/lib/firebaseAuthApi';
import { writeAuditLog } from '@/lib/auditLog';
import { isAdmin, getRoleDisplayName, getDepartment, VALID_ROLES } from '@/lib/roleUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Shield, UserPlus, Loader2, Trash2, Users, User, ScrollText } from 'lucide-react';
import { toast } from 'sonner';

interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  role: string;
  createdAt: string;
}

export default function UserManagement() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newRole, setNewRole] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as UserRecord));
        setUsers(data);
        setUsersLoading(false);
      },
      () => {
        setUsersLoading(false);
      }
    );
    return () => unsub();
  }, []);

  if (!user) {
    navigate('/login');
    return null;
  }
  if (!isAdmin(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-muted-foreground">
        <Shield className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">ဤစာမျက်နှာကို ဝင်ရောက်ခွင့်မရှိပါ</p>
        <p className="text-xs mt-1">Admin အခွင့်အာဏာသာ လိုအပ်ပါသည်</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password || !newRole) {
      toast.error('အချက်အလက်အားလုံးကို ဖြည့်စွက်ပါ');
      return;
    }
    if (password.length < 6) {
      toast.error('စကားဝှက် အနည်းဆုံး ၆ လုံး ဖြစ်ရမည်');
      return;
    }

    setFormLoading(true);
    try {
      const { uid } = await createFirebaseUser(email.trim(), password);

      await setDoc(doc(db, 'users', uid), {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role: newRole,
        createdAt: new Date().toISOString(),
        createdBy: user?.email || 'Unknown',
      });

      await writeAuditLog('user_created', uid, user?.uid || 'system', user?.email || 'system', {
        targetUserEmail: email.trim().toLowerCase(),
        targetUserName: fullName.trim(),
        targetDepartment: getDepartment(newRole),
        newValue: newRole,
        notes: 'ဝန်ထမ်းအကောင့်အသစ်ဖွင့်',
        performerDepartment: getDepartment(role),
      });

      toast.success('ဝန်ထမ်းအကောင့်ဖွင့်ခြင်း အောင်မြင်ပါသည်');
      setFullName('');
      setEmail('');
      setPassword('');
      setNewRole('');
    } catch (err: any) {
      const msg = err?.message || 'အကောင့်ဖွင့်ရာတွင် အမှားတစ်ခု ဖြစ်သွားပါသည်';
      toast.error(msg);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'users', deleteTarget.id));
      await writeAuditLog('user_deleted', deleteTarget.id, user?.uid || 'system', user?.email || 'system', {
        targetUserEmail: deleteTarget.email,
        targetUserName: deleteTarget.fullName,
        targetDepartment: getDepartment(deleteTarget.role),
        oldValue: deleteTarget.role,
        notes: 'ဝန်ထမ်းအကောင့်ဖယ်ရှား',
        performerDepartment: getDepartment(role),
      });
      toast.success('ဝန်ထမ်းအကောင့်ဖယ်ရှားခြင်း အောင်မြင်ပါသည်');
    } catch {
      toast.error('ဖယ်ရှားရာတွင် အမှားတစ်ခု ဖြစ်သွားပါသည်');
    } finally {
      setDeleteTarget(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold text-foreground leading-snug">
          ဝန်ထမ်းအကောင့်များ
        </h1>
        <p className="text-sm text-muted-foreground mt-1">User Management</p>
      </div>

      {/* Quick Add Form */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            ဝန်ထမ်းအကောင့်အသစ်ဖွင့်ရန်
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-sm font-medium">
                ပူးပေါင်းဆောင်ရွက်သူအမည်
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="ဥပမာ - Mg Kyaw Zin"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                အီးမေးလ်
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="employee@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                စကားဝှက် (ယာယ်)
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="အနည်းဆုံး ၆ လုံး"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role" className="text-sm font-medium">
                အခွင့်အဆင့်
              </Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="အခွင့်အဆင့် ရွေးချယ်ပါ" />
                </SelectTrigger>
                <SelectContent>
                  {VALID_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {getRoleDisplayName(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              disabled={formLoading}
              className="h-12 w-full gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 hover:shadow-card-hover active:scale-[0.98]"
            >
              {formLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              {formLoading ? 'ဖွင့်နေသည်...' : 'ဝန်ထမ်းအကောင့်ဖွင့်ရန်'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Employee Directory — Mobile Cards + Desktop Table */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            ဝန်ထမ်းစာရင်း
            <span className="text-xs font-normal text-muted-foreground ml-1">
              ({users.length} ယောက်)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <User className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">ဝန်ထမ်းအကောင့်မရှိသေးပါ</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block w-full max-w-full overflow-x-auto bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">အမည်</TableHead>
                      <TableHead className="whitespace-nowrap">အီးမေးလ်</TableHead>
                      <TableHead className="whitespace-nowrap">အခွင့်အဆင့်</TableHead>
                      <TableHead className="whitespace-nowrap">မှတ်ပုံတင်သည့်ရက်</TableHead>
                      <TableHead className="whitespace-nowrap text-right">လုပ်ဆောင်ချက်</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="whitespace-nowrap font-medium">{u.fullName}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{u.email}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Select
                            value={u.role}
                            onValueChange={async (val) => {
                              try {
                                await setDoc(doc(db, 'users', u.id), { role: val }, { merge: true });
                                await writeAuditLog('role_changed', u.id, user?.uid || 'system', user?.email || 'system', {
                                  targetUserEmail: u.email,
                                  targetUserName: u.fullName,
                                  targetDepartment: getDepartment(val),
                                  oldValue: u.role,
                                  newValue: val,
                                  performerDepartment: getDepartment(role),
                                });
                                toast.success('အခွင့်အဆင့် ပြောင်းလဲခြင်း အောင်မြင်ပါသည်');
                              } catch {
                                toast.error('အခွင့်အဆင့် ပြောင်းရာတွင် အမှားဖြစ်သွားပါသည်');
                              }
                            }}
                          >
                            <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {VALID_ROLES.map((r) => <SelectItem key={r} value={r}>{getRoleDisplayName(r)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(u)}
                                className="w-9 h-9 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
                                title="ဖယ်ရှားရန်"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
                              <AlertDialogHeader>
                                <AlertDialogTitle>ဝန်ထမ်းဖယ်ရှားရန်</AlertDialogTitle>
                                <AlertDialogDescription>
                                  <span className="font-medium text-foreground">{deleteTarget?.fullName}</span> ၏ အကောင့်ကို ဖယ်ရှားရန် သေချာပါသလား? CRM ဝင်ရောက်ခွင့်ကို ပိတ်ပစ်မည်ဖြစ်ပြီး ဤလုပ်ဆောင်ချက်ကို ပြန်လည်ရုပ်သိမ်းနိုင်မည်မဟုတ်ပါ။
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel onClick={() => setDeleteTarget(null)}>မလုပ်ဆောင်ပါ</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">ဖယ်ရှားမည်</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card List */}
              <div className="md:hidden divide-y divide-border">
                {users.map((u) => (
                  <div key={u.id} className="p-4 space-y-3 active:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{u.fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      {/* Role badge chip */}
                      <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-medium shrink-0">
                        {getRoleDisplayName(u.role)}
                      </span>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(u)}
                            className="w-10 h-10 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 active:bg-destructive/20 transition-colors shrink-0"
                            title="ဖယ်ရှားရန်"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
                          <AlertDialogHeader>
                            <AlertDialogTitle>ဝန်ထမ်းဖယ်ရှားရန်</AlertDialogTitle>
                            <AlertDialogDescription>
                              <span className="font-medium text-foreground">{deleteTarget?.fullName}</span> ၏ အကောင့်ကို ဖယ်ရှားရန် သေချာပါသလား?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>မလုပ်ဆောင်ပါ</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">ဖယ်ရှားမည်</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select
                        value={u.role}
                        onValueChange={async (val) => {
                          try {
                            await setDoc(doc(db, 'users', u.id), { role: val }, { merge: true });
                            await writeAuditLog('role_changed', u.id, user?.uid || 'system', user?.email || 'system', {
                              targetUserEmail: u.email,
                              targetUserName: u.fullName,
                              targetDepartment: getDepartment(val),
                              oldValue: u.role,
                              newValue: val,
                              performerDepartment: getDepartment(role),
                            });
                            toast.success('အခွင့်အဆင့် ပြောင်းလဲခြင်း အောင်မြင်ပါသည်');
                          } catch {
                            toast.error('အခွင့်အဆင့် ပြောင်းရာတွင် အမှားဖြစ်သွားပါသည်');
                          }
                        }}
                      >
                        <SelectTrigger className="h-12 w-full text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VALID_ROLES.map((r) => <SelectItem key={r} value={r}>{getRoleDisplayName(r)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">မှတ်ပုံတင်သည့်ရက်: {formatDate(u.createdAt)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
