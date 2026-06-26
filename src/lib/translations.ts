export type Lang = 'mm' | 'en';

export const translations: Record<string, Record<Lang, string>> = {
  // Common
  'app.name': {
    mm: 'PSM Properties CRM',
    en: 'PSM Properties CRM',
  },
  'app.version': {
    mm: 'ဗားရှင်း',
    en: 'Version',
  },
  'nav.dashboard': {
    mm: 'Dashboard',
    en: 'Dashboard',
  },
  'nav.leads': {
    mm: 'Lead များ',
    en: 'Leads',
  },
  'nav.addLead': {
    mm: 'Lead အသစ်ထည့်ရန်',
    en: 'Add Lead',
  },
  'nav.checkIn': {
    mm: 'ဆိုက်ရောက်မှတ်တမ်း',
    en: 'Check-In',
  },
  'nav.gallery': {
    mm: 'ဓာတ်ပုံ မှတ်တမ်းများ',
    en: 'Photo Gallery',
  },
  'nav.map': {
    mm: 'မြေပုံ',
    en: 'Map',
  },
  'nav.analytics': {
    mm: 'Analytics',
    en: 'Analytics',
  },
  'nav.settings': {
    mm: 'ဆက်တင်များ',
    en: 'Settings',
  },
  'nav.notifications': {
    mm: 'အသိပေးချက်များ',
    en: 'Notifications',
  },
  'nav.fileCloud': {
    mm: 'File Cloud',
    en: 'File Cloud',
  },
  'nav.users': {
    mm: 'အသုံးပြုသူများ',
    en: 'Users',
  },
  'common.search': {
    mm: 'ရှာဖွေရန်...',
    en: 'Search...',
  },
  'common.filter': {
    mm: 'စစ်ထုတ်ရန်',
    en: 'Filter',
  },
  'common.reset': {
    mm: 'ပြန်လည်သတ်မှတ်ရန်',
    en: 'Reset',
  },
  'common.save': {
    mm: 'သိမ်းဆည်းရန်',
    en: 'Save',
  },
  'common.cancel': {
    mm: 'ပယ်ဖျက်ရန်',
    en: 'Cancel',
  },
  'common.delete': {
    mm: 'ဖျက်ရန်',
    en: 'Delete',
  },
  'common.edit': {
    mm: 'ပြင်ဆင်ရန်',
    en: 'Edit',
  },
  'common.view': {
    mm: 'ကြည့်ရန်',
    en: 'View',
  },
  'common.loading': {
    mm: 'လုပ်ဆောင်နေသည်...',
    en: 'Loading...',
  },
  'common.noData': {
    mm: 'ဒေတာမရှိသေးပါ',
    en: 'No data available',
  },
  'common.total': {
    mm: 'စုစုပေါင်း',
    en: 'Total',
  },
  'common.status': {
    mm: 'အခြေအနေ',
    en: 'Status',
  },
  'common.date': {
    mm: 'ရက်စွဲ',
    en: 'Date',
  },
  'common.agent': {
    mm: 'Agent',
    en: 'Agent',
  },
  'common.department': {
    mm: 'ဌာန',
    en: 'Department',
  },
  'common.all': {
    mm: 'အားလုံး',
    en: 'All',
  },
  'common.close': {
    mm: 'ပိတ်ရန်',
    en: 'Close',
  },
  'common.name': {
    mm: 'အမည်',
    en: 'Name',
  },
  'common.phone': {
    mm: 'ဖုန်းနံပါတ်',
    en: 'Phone',
  },
  'common.email': {
    mm: 'အီးမေးလ်',
    en: 'Email',
  },
  'common.location': {
    mm: 'တည်နေရာ',
    en: 'Location',
  },
  'common.action': {
    mm: 'လုပ်ဆောင်ချက်',
    en: 'Action',
  },
  'common.export': {
    mm: 'ထုတ်ယူရန်',
    en: 'Export',
  },
  'common.import': {
    mm: 'တင်ရန်',
    en: 'Import',
  },
  'common.success': {
    mm: 'အောင်မြင်ပါသည်',
    en: 'Success',
  },
  'common.error': {
    mm: 'အမှားဖြစ်သွားပါသည်',
    en: 'Error occurred',
  },
  // Lead Map
  'map.title': {
    mm: 'Lead မြေပုံ',
    en: 'Lead Map',
  },
  'map.subtitle': {
    mm: 'Lead များကို မြေပုံပေါ်တွင် ကြည့်ရှုရန်',
    en: 'View leads on the map',
  },
  'map.selectLead': {
    mm: 'မြေပုံပေါ်တွင် ပြသရန် Lead ရွေးချယ်ပါ',
    en: 'Select a lead to display on map',
  },
  'map.gpsMissing': {
    mm: 'GPS ဒေတာ မရှိပါ',
    en: 'GPS data not available',
  },
  'map.viewLocation': {
    mm: 'တည်နေရာ ကြည့်ရန်',
    en: 'View Location',
  },
  // Analytics
  'analytics.title': {
    mm: 'Analytics Dashboard',
    en: 'Analytics Dashboard',
  },
  'analytics.conversion': {
    mm: 'ပြောင်းလဲမှု နှုန်း',
    en: 'Conversion Rate',
  },
  'analytics.agentPerformance': {
    mm: 'Agent အသက်သာမှု',
    en: 'Agent Performance',
  },
  'analytics.revenue': {
    mm: 'ငွေဝင်မှတ်တမ်း',
    en: 'Revenue Summary',
  },
  'analytics.leadsByStatus': {
    mm: 'အခြေအနေအလိုက် Lead များ',
    en: 'Leads by Status',
  },
  'analytics.leadsBySource': {
    mm: 'လမ်းကြောင်းအလိုက် Lead များ',
    en: 'Leads by Source',
  },
  'analytics.monthlyTrend': {
    mm: 'လစဉ် အပြောင်းအလဲ',
    en: 'Monthly Trend',
  },
  'analytics.topAgents': {
    mm: 'ထိပ်ဆုံး Agent များ',
    en: 'Top Agents',
  },
  'analytics.avgDealSize': {
    mm: 'ပျမ်းမျှ လုပ်ငန်း အရွယ်အစား',
    en: 'Avg Deal Size',
  },
  'analytics.closedDeals': {
    mm: 'ပိတ်သိမ်းပြီး လုပ်ငန်း',
    en: 'Closed Deals',
  },
  // Settings i18n
  'settings.language': {
    mm: 'ဘာသာစကား',
    en: 'Language',
  },
  'settings.myanmar': {
    mm: 'မြန်မာ',
    en: 'Myanmar',
  },
  'settings.english': {
    mm: 'English',
    en: 'English',
  },
};

export function t(key: string, lang: Lang): string {
  return translations[key]?.[lang] || key;
}
