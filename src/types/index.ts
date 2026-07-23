import type { Department, RoleTier } from '@/lib/permissions';

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'appointment' | 'site_visit' | 'negotiation' | 'booking' | 'sold' | 'lost';
export type LeadGrade = 'A' | 'B' | 'C';
export type FollowUpType = 'phone' | 'messenger' | 'whatsapp' | 'viber' | 'email' | 'meeting' | 'site_visit';
export type FollowUpStatus = 'interested' | 'not_interested' | 'busy' | 'no_answer' | 'call_later' | 'site_visit' | 'booking' | 'lost';
export type CheckInStatus = 'on_time' | 'late' | 'absent' | 'leave' | 'field_work';
export type WarningReason = 'followup_overdue' | 'customer_complaint' | 'no_activity' | 'late_checkin' | 'pipeline_stalled' | 'missed_appointment';
export type NotificationType = 'new_lead_assigned' | 'followup_reminder' | 'appointment_reminder' | 'site_visit_reminder' | 'booking_confirmation' | 'warning_notification' | 'checkin_reminder';
export type ApptStatus = 'scheduled' | 'completed' | 'missed' | 'cancelled';
export type SystemMessageType = 'info' | 'warning' | 'maintenance' | 'critical';

export interface SystemMessage {
  id: string;
  message: string;
  type: SystemMessageType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Site-wide, blocking maintenance gate — distinct from SystemMessage, which
 * is just a dismissible banner alongside the still-working app. Singleton
 * row (id is always 1). */
export interface MaintenanceSettings {
  id: number;
  is_enabled: boolean;
  title: string;
  message: string;
  image_url: string | null;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  role: RoleTier;
  department_code: Department | null;
  status: 'active' | 'inactive';
  avatar_url?: string | null;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  department_code: Department;
  manager_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TeamMember {
  team_id: string;
  sale_person_id: string;
  added_at: string;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  current_location?: string | null;
  interest_type?: string | null;
  property_type?: string | null;
  preferred_project?: string | null;
  budget_range?: string | null;
  purpose?: string | null;
  lead_source?: string | null;
  department_code: Department;
  team_id?: string | null;
  status: LeadStage;
  lead_grade?: LeadGrade | null;
  lead_grade_reason?: string | null;
  owner_id?: string | null;
  created_by?: string | null;
  sale_amount?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  next_follow_up_at?: string | null;
  remarks?: string | null;
  created_at: string;
  updated_at: string;
  // Joined convenience fields (populated by some queries, not columns)
  owner_name?: string | null;
}

export interface LeadAssignment {
  id: string;
  lead_id: string;
  assigned_to: string;
  assigned_by: string | null;
  note?: string | null;
  assigned_at: string;
}

export interface FollowUp {
  id: string;
  lead_id: string;
  created_by?: string | null;
  type: FollowUpType;
  status: FollowUpStatus;
  notes?: string | null;
  next_follow_up_at?: string | null;
  created_at: string;
}

export interface PipelineHistoryEntry {
  id: string;
  lead_id: string;
  from_stage: LeadStage | null;
  to_stage: LeadStage;
  changed_by?: string | null;
  changed_at: string;
}

export interface Appointment {
  id: string;
  lead_id: string;
  scheduled_by?: string | null;
  scheduled_at: string;
  location?: string | null;
  notes?: string | null;
  status: ApptStatus;
  created_at: string;
}

export type SiteVisit = Omit<Appointment, never>;

export interface Warning {
  id: string;
  lead_id?: string | null;
  issued_to: string;
  issued_by: string;
  reason: WarningReason;
  message?: string | null;
  created_at: string;
}

export interface CheckIn {
  id: string;
  employee_id: string;
  department_code: Department;
  check_in_date: string;
  check_in_time: string;
  latitude?: number | null;
  longitude?: number | null;
  photo_url?: string | null;
  status: CheckInStatus;
  is_late: boolean;
  notes?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  recipient_id: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  related_lead_id?: string | null;
  is_read: boolean;
  created_at: string;
}

export const LEAD_STAGES: { value: LeadStage; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'booking', label: 'Booking' },
  { value: 'sold', label: 'Sold' },
  { value: 'lost', label: 'Lost' },
];

export const FOLLOWUP_TYPES: { value: FollowUpType; label: string }[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'viber', label: 'Viber' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'site_visit', label: 'Site Visit' },
];

export const FOLLOWUP_STATUSES: { value: FollowUpStatus; label: string }[] = [
  { value: 'interested', label: 'Interested' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'busy', label: 'Busy' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'call_later', label: 'Call Later' },
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'booking', label: 'Booking' },
  { value: 'lost', label: 'Lost' },
];

// Follow-up status and lead grade are one signal, not two — this mirrors
// the public.followup_status_to_grade() DB function exactly. Every time a
// follow-up is recorded, database/crm.sql's trg_followups_sync_grade
// trigger recomputes the lead's grade from this same mapping, so the two
// can never drift apart regardless of which page added the follow-up.
export const FOLLOWUP_STATUS_TO_GRADE: Record<FollowUpStatus, LeadGrade> = {
  booking: 'A',
  site_visit: 'A',
  interested: 'B',
  call_later: 'B',
  busy: 'C',
  no_answer: 'C',
  not_interested: 'C',
  lost: 'C',
};

export function getGradeForFollowUpStatus(status: FollowUpStatus): LeadGrade {
  return FOLLOWUP_STATUS_TO_GRADE[status];
}

export const CHECKIN_STATUSES: { value: CheckInStatus; label: string }[] = [
  { value: 'on_time', label: 'On Time' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'leave', label: 'Leave' },
  { value: 'field_work', label: 'Field Work' },
];

export const WARNING_REASONS: { value: WarningReason; label: string }[] = [
  { value: 'followup_overdue', label: 'Follow-up Overdue' },
  { value: 'customer_complaint', label: 'Customer Complaint' },
  { value: 'no_activity', label: 'No Activity' },
  { value: 'late_checkin', label: 'Late Check-in' },
  { value: 'pipeline_stalled', label: 'Pipeline Stalled' },
  { value: 'missed_appointment', label: 'Missed Appointment' },
];

export const SYSTEM_MESSAGE_TYPES: { value: SystemMessageType; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'critical', label: 'Critical' },
];

export const LEAD_GRADES: { value: LeadGrade; label: string }[] = [
  { value: 'A', label: 'Level A (Hot/Ready)' },
  { value: 'B', label: 'Level B (Warm/Considering)' },
  { value: 'C', label: 'Level C (Cold/Inquiring)' },
];

export const INTEREST_TYPES = ['ဝယ်ရန်', 'ငှားရန်', 'ရောင်းရန်'];
export const PROPERTY_TYPES = ['ကွန်ဒို', 'လုံးချင်း', 'တိုက်ခန်း', 'မြေကွက်'];
export const BUDGET_RANGES = ['သိန်း ၁၀၀၀ အောက်', 'သိန်း ၁၀၀၀ မှ ၃၀၀၀ ကြား', 'သိန်း ၃၀၀၀ မှ ၅၀၀၀ ကြား', 'သိန်း ၅၀၀၀ မှ ၁၀၀၀၀ ကြား', 'သိန်း ၁၀၀၀၀ အထက်'];
export const PURPOSES = ['ကိုယ်တိုင်နေထိုင်ရန်', 'ရင်းနှီးမြှုပ်နှံရန်', 'စီးပွားရေး'];
export const LEAD_SOURCES = ['Facebook', 'TikTok', 'YouTube', 'Instagram', 'Boss Content', 'Admin Content'];
