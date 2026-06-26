import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollText, Shield, ArrowRightLeft, UserPlus, Trash2 } from 'lucide-react';
import { isAdmin, isManagerLevel, getDepartment } from '@/lib/roleUtils';
import type { AuditLog as AuditLogEntry } from '@/types';

interface AuditLogItem extends AuditLogEntry {
  id: string;
}

const actionMeta: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  role_changed: { label: 'အခွင့်အဆင့် ပြောင်းလဲမှု', icon: <ArrowRightLeft className="w-3.5 h-3.5" />, color: 'text-primary bg-primary/10' },
  user_created: { label: 'အကောင့်အသစ်ဖွင့်', icon: <UserPlus className="w-3.5 h-3.5" />, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400' },
  user_deleted: { label: 'အကောင့်ဖယ်ရှား', icon: <Trash2 className="w-3.5 h-3.5" />, color: 'text-destructive bg-destructive/10' },
};

export default function AuditLog() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const userDept = getDepartment(role);
  const isAdminUser = isAdmin(role);
  const isManager = isManagerLevel(role);

  // Fetch audit logs
  useEffect(() => {
    const q = query(collection(db, 'auditLogs'), orderBy('performedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogItem));
        setLogs(data);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Fetch users to build email → department map (for filtering legacy logs without performerDepartment)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const map: Record<string, string> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (data.email) {
          map[data.email.toLowerCase()] = getDepartment(data.role) || 'house';
        }
      });
      setUsersMap(map);
    });
    return () => unsub();
  }, []);

  const filteredLogs = useMemo(() => {
    if (isAdminUser) return logs;
    if (!isManager) return [];
    return logs.filter((log) => {
      // Prefer explicit performerDepartment on the log
      if (log.performerDepartment) {
        return log.performerDepartment === userDept;
      }
      // Fallback: derive from users map by performer email
      const dept = usersMap[log.performedBy.toLowerCase()];
      return !dept || dept === userDept;
    });
  }, [logs, isAdminUser, isManager, userDept, usersMap]);

  if (!user) {
    navigate('/login');
    return null;
  }
  if (!isAdminUser && !isManager) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-muted-foreground">
        <Shield className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">ဤစာမျက်နှာကို ဝင်ရောက်ခွင့်မရှိပါ</p>
        <p className="text-xs mt-1">Admin သို့မဟုတ် Manager အခွင့်အာဏာသာ လိုအပ်ပါသည်</p>
      </div>
    );
  }

  const formatDate = (ts: any) => {
    if (!ts) return '—';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    try {
      return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold text-foreground leading-snug">
          Audit Log — ဝန်ထမ်းပြောင်းလဲမှု မှတ်တမ်း
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          User role နှင့် အကောင့်ပြောင်းလဲမှုများကို မှတ်တမ်းတင်ထားခြင်း
        </p>
      </div>

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" />
            ပြောင်းလဲမှု မှတ်တမ်း
            <span className="text-xs font-normal text-muted-foreground ml-1">
              ({filteredLogs.length} / {logs.length} မှတ်တမ်း)
              {isManager && !isAdminUser && (
                <span className="ml-1 text-warning">· {userDept === 'house' ? 'အိမ်ရာ' : userDept === 'condo' ? 'ကွန်ဒို' : 'ပရောဂျက်'} ဌာနသာ</span>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <ScrollText className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">မှတ်တမ်း မရှိသေးပါ</p>
              <p className="text-xs">
                {isManager && !isAdminUser
                  ? 'ဤဌာနတွင် User အကောင့်ပြောင်းလဲမှုများ မရှိသေးပါ'
                  : 'User အကောင့်ပြောင်းလဲမှုများဖြစ်လျှင် ဤနေရာတွင် ပေါ်လာမည်ဖြစ်သည်'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block w-full max-w-full overflow-x-auto bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">လုပ်ဆောင်ချက်</TableHead>
                      <TableHead className="whitespace-nowrap">ဝန်ထမ်း</TableHead>
                      <TableHead className="whitespace-nowrap">အခွင့်အဆင့်</TableHead>
                      <TableHead className="whitespace-nowrap">ပြုလုပ်သူ</TableHead>
                      <TableHead className="whitespace-nowrap">ဌာန</TableHead>
                      <TableHead className="whitespace-nowrap">ရက်စွဲ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => {
                      const meta = actionMeta[log.action] || { label: log.action, icon: null, color: 'text-muted-foreground bg-muted' };
                      const dept = log.performerDepartment || usersMap[log.performedBy.toLowerCase()] || '—';
                      const deptLabel = dept === 'house' ? 'အိမ်ရာ' : dept === 'condo' ? 'ကွန်ဒို' : dept === 'project' ? 'ပရောဂျက်' : dept;
                      return (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${meta.color}`}>
                              {meta.icon} {meta.label}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="font-medium text-foreground">{log.targetUserName || '—'}</div>
                            <div className="text-xs text-muted-foreground">{log.targetUserEmail || '—'}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {log.action === 'role_changed' ? (
                              <span className="text-sm">
                                <span className="text-muted-foreground line-through">{log.oldValue}</span>
                                <span className="mx-1 text-muted-foreground">→</span>
                                <span className="font-medium text-foreground">{log.newValue}</span>
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">{log.newValue || log.oldValue || '—'}</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{log.performedBy}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{deptLabel}</span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(log.performedAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card List */}
              <div className="md:hidden divide-y divide-border">
                {filteredLogs.map((log) => {
                  const meta = actionMeta[log.action] || { label: log.action, icon: null, color: 'text-muted-foreground bg-muted' };
                  const dept = log.performerDepartment || usersMap[log.performedBy.toLowerCase()] || '—';
                  const deptLabel = dept === 'house' ? 'အိမ်ရာ' : dept === 'condo' ? 'ကွန်ဒို' : dept === 'project' ? 'ပရောဂျက်' : dept;
                  return (
                    <div key={log.id} className="p-4 space-y-2.5 active:bg-muted/30 transition-colors min-h-[72px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium ${meta.color}`}>
                          {meta.icon} {meta.label}
                        </span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">{deptLabel}</span>
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">{log.targetUserName || '—'}</span>
                        <span className="text-xs text-muted-foreground truncate">{log.targetUserEmail || '—'}</span>
                      </div>
                      {log.action === 'role_changed' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground line-through px-2 py-0.5 rounded bg-muted/50">{log.oldValue}</span>
                          <span className="text-xs text-muted-foreground">→</span>
                          <span className="text-xs font-semibold text-foreground px-2 py-0.5 rounded bg-primary/10">{log.newValue}</span>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{log.newValue || log.oldValue || '—'}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <UserPlus className="w-3 h-3" />
                          {log.performedBy}
                        </span>
                        <span className="flex items-center gap-1">
                          <ScrollText className="w-3 h-3" />
                          {formatDate(log.performedAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
