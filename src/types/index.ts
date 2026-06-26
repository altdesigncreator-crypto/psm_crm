export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  currentLocation?: string;
  interestType?: string;
  propertyType?: string;
  preferredProject?: string;
  budgetRange?: string;
  purpose?: string;
  urgency?: string;
  urgencyRemarks?: string;
  paymentMethod?: string;
  leadSource?: string;
  status: string;
  leadLevel?: string;
  assignedAgent?: string;
  showPerson?: string;
  nextFollowUpDate?: string;
  remarks?: string;
  voiceNoteURL?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  createdAt?: any;
  /** UID of the user who created this lead (for security rules) */
  ownerId?: string;
  /** Department this lead belongs to: house | condo | project */
  department?: 'house' | 'condo' | 'project' | string;
}

export interface AuditLog {
  id?: string;
  action: 'role_changed' | 'user_created' | 'user_deleted' | 'user_invited';
  targetUserId: string;
  targetUserEmail?: string;
  targetUserName?: string;
  targetDepartment?: string;
  oldValue?: string;
  newValue?: string;
  performedBy: string;
  performedByUid: string;
  performerDepartment?: string;
  performedAt: any;
  notes?: string;
}

export const LEAD_LEVELS = [
  'Level A (Hot/Ready)',
  'Level B (Warm/Considering)',
  'Level C (Cold/Inquiring)',
];

export const STATUSES = ['New', 'Contacted', 'Follow Up', 'Success'];

export const INTEREST_TYPES = ['ဝယ်ရန်', 'ငှားရန်', 'ရောင်းရန်'];
export const PROPERTY_TYPES = ['ကွန်ဒို', 'လုံးချင်း', 'တိုက်ခန်း', 'မြေကွက်'];
export const BUDGET_RANGES = ['သိန်း ၁၀၀၀ အောက်', 'သိန်း ၁၀၀၀ မှ ၃၀၀၀ ကြား', 'သိန်း ၃၀၀၀ မှ ၅၀၀၀ ကြား', 'သိန်း ၅၀၀၀ မှ ၁၀၀၀၀ ကြား', 'သိန်း ၁၀၀၀၀ အထက်'];
export const PURPOSES = ['ကိုယ်တိုင်နေထိုင်ရန်', 'ရင်းနှီးမြှုပ်နှံရန်', 'စီးပွားရေး'];
export const URGENCIES = [
  'ချက်ချင်း / ၁ လအတွင်း',
  '၁ လ မှ ၆ လ အတွင်း',
  '၆ လ မှ ၁ နှစ် အတွင်း',
  '၁ နှစ် မှ ၃ နှစ် အတွင်း',
  '၃ နှစ် အထက်',
  'မသေချာသေးပါ / ဆုံးဖြတ်ဆဲ',
];
export const PAYMENT_METHODS = ['လက်ငင်း', 'ဘဏ်ချိတ်', 'အရစ်ကျ'];
export const LEAD_SOURCES = ['Facebook', 'TikTok', 'YouTube', 'Instagram', 'Boss Content', 'Admin Content'];

export interface CheckIn {
  id: string;
  agentName: string;
  agentEmail: string;
  location: string;
  description?: string;
  photoURL: string;
  latitude?: number | null;
  longitude?: number | null;
  createdAt?: any;
  ownerId?: string;
  department?: 'house' | 'condo' | 'project' | string;
}

export interface VoiceNote {
  id: string;
  agentName: string;
  agentEmail: string;
  audioURL: string;
  duration?: number;
  createdAt?: any;
  ownerId?: string;
  department?: 'house' | 'condo' | 'project' | string;
}
