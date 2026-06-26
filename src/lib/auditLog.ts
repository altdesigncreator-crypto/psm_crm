import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { AuditLog } from '@/types';

export async function writeAuditLog(
  action: AuditLog['action'],
  targetUserId: string,
  performedByUid: string,
  performedBy: string,
  opts?: {
    targetUserEmail?: string;
    targetUserName?: string;
    targetDepartment?: string;
    oldValue?: string;
    newValue?: string;
    notes?: string;
    performerDepartment?: string;
  }
): Promise<void> {
  const log: Omit<AuditLog, 'id'> = {
    action,
    targetUserId,
    performedByUid,
    performedBy,
    performedAt: serverTimestamp(),
    targetUserEmail: opts?.targetUserEmail,
    targetUserName: opts?.targetUserName,
    targetDepartment: opts?.targetDepartment,
    oldValue: opts?.oldValue,
    newValue: opts?.newValue,
    notes: opts?.notes,
    performerDepartment: opts?.performerDepartment,
  };
  await addDoc(collection(db, 'auditLogs'), log);
}
