import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { type Lead } from '@/types';

const EXPORT_HEADERS = [
  'ဝယ်သူအမည်',
  'ဖုန်းနံပါတ်',
  'အီးမေးလ်',
  'လက်ရှိနေရာ',
  'Project',
  'ဘတ်ဂျက်',
  'အခြေအနေ',
  'အဆင့်',
  'စိတ်ဝင်စားမှု',
  'အိမ်ရာအမျိုးအစား',
  'ရည်ရွယ်ချက်',
  'အရေးကြီးမှု',
  'အရင်းအမြစ်',
  'တာဝန်ခံဝန်ထမ်း',
  'Show Person',
  'ဆက်သွယ်ရမည့်ရက်',
  'ဌာန',
  'မှတ်ချက်',
];

function getLeadRow(l: Lead): string[] {
  return [
    l.name,
    l.phone,
    l.email || '',
    l.currentLocation || '',
    l.preferredProject || '',
    l.budgetRange || '',
    l.status,
    l.leadLevel || '',
    l.interestType || '',
    l.propertyType || '',
    l.purpose || '',
    l.urgency || '',
    l.leadSource || '',
    l.assignedAgent || '',
    l.showPerson || '',
    l.nextFollowUpDate || '',
    l.department || '',
    l.remarks || '',
  ];
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 200);
}

function getExportFileName(base: string, count: number, ext: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `PSM_${base}_${count}records_${date}.${ext}`;
}

export function exportAsExcel(leads: Lead[]) {
  if (leads.length === 0) return;
  const data = leads.map((l) => ({
    'ဝယ်သူအမည်': l.name,
    'ဖုန်းနံပါတ်': l.phone,
    'အီးမေးလ်': l.email || '',
    'လက်ရှိနေရာ': l.currentLocation || '',
    'Project': l.preferredProject || '',
    'ဘတ်ဂျက်': l.budgetRange || '',
    'အခြေအနေ': l.status,
    'အဆင့်': l.leadLevel || '',
    'စိတ်ဝင်စားမှု': l.interestType || '',
    'အိမ်ရာအမျိုးအစား': l.propertyType || '',
    'ရည်ရွယ်ချက်': l.purpose || '',
    'အရေးကြီးမှု': l.urgency || '',
    'အရင်းအမြစ်': l.leadSource || '',
    'တာဝန်ခံဝန်ထမ်း': l.assignedAgent || '',
    'Show Person': l.showPerson || '',
    'ဆက်သွယ်ရမည့်ရက်': l.nextFollowUpDate || '',
    'ဌာန': l.department || '',
    'မှတ်ချက်': l.remarks || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, getExportFileName('Leads', leads.length, 'xlsx'));
}

export function exportAsPDF(leads: Lead[]) {
  if (leads.length === 0) return;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.text('PSM Sale CRM - Leads Report', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, 25);

  const rows = leads.map((l) => getLeadRow(l));

  autoTable(doc, {
    startY: 30,
    head: [EXPORT_HEADERS],
    body: rows,
    theme: 'striped',
    styles: {
      fontSize: 9,
      cellPadding: 2,
      overflow: 'linebreak',
      minCellHeight: 6,
    },
    headStyles: {
      fillColor: [4, 99, 202],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 30 },
      2: { cellWidth: 40 },
      3: { cellWidth: 45 },
      4: { cellWidth: 30 },
      5: { cellWidth: 30 },
      6: { cellWidth: 35 },
      7: { cellWidth: 30 },
    },
    margin: { left: 10, right: 10, top: 10, bottom: 10 },
    didDrawPage: (data) => {
      doc.setFontSize(8);
      doc.setTextColor(150);
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.text(`Page ${data.pageNumber} of ${pageCount}`, data.settings.margin.left, doc.internal.pageSize.height - 10);
    },
  });

  const blob = doc.output('blob');
  triggerDownload(blob, getExportFileName('Leads', leads.length, 'pdf'));
}

export function exportAsCSV(leads: Lead[]) {
  if (leads.length === 0) return;
  const headers = ['ဝယ်သူအမည်', 'ဖုန်းနံပါတ်', 'အီးမေးလ်', 'လက်ရှိနေရာ', 'Project', 'ဘတ်ဂျက်', 'အခြေအနေ', 'အဆင့်', 'စိတ်ဝင်စားမှု', 'အိမ်ရာအမျိုးအစား', 'ရည်ရွယ်ချက်', 'အရေးကြီးမှု', 'အရင်းအမြစ်', 'တာဝန်ခံဝန်ထမ်း', 'Show Person', 'ဆက်သွယ်ရမည့်ရက်', 'ဌာန', 'မှတ်ချက်'];
  const rows = leads.map((l) => getLeadRow(l));
  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell) => {
        const val = String(cell ?? '');
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(',')
    )
    .join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, getExportFileName('Leads', leads.length, 'csv'));
}

export function exportAsHTML(leads: Lead[]) {
  if (leads.length === 0) return;
  const rows = leads.map((l) => getLeadRow(l));

  const html = `<!DOCTYPE html>
<html lang="my">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PSM Sale CRM - Leads Export</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #F8FAFC; color: #1e293b; padding: 32px; }
.container { max-width: 1400px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
.header { background: linear-gradient(135deg, #0463CA 0%, #0487E2 100%); color: #fff; padding: 24px 28px; }
.header h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
.header p { font-size: 13px; opacity: 0.85; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: #F1F5F9; color: #475569; font-weight: 600; text-align: left; padding: 14px 18px; border-bottom: 1px solid #E2E8F0; white-space: nowrap; }
td { padding: 12px 18px; border-bottom: 1px solid #F1F5F9; color: #334155; }
tr:hover td { background: #F8FAFC; }
tbody tr:last-child td { border-bottom: none; }
.footer { padding: 16px 28px; background: #F8FAFC; border-top: 1px solid #E2E8F0; font-size: 12px; color: #94A3B8; text-align: right; }
@media (max-width: 768px) { body { padding: 12px; } th, td { padding: 10px 12px; font-size: 12px; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>PSM Sale CRM</h1>
    <p>Lead Data Export &middot; ${new Date().toLocaleDateString('en-GB')}</p>
  </div>
  <table>
    <thead>
      <tr>
        ${EXPORT_HEADERS.map((h) => `<th>${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>
  <div class="footer">Exported from PSM Sale CRM &middot; ${leads.length} records</div>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = getExportFileName('Leads', leads.length, 'html');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── KPI Export ─────────────────────────────────────────────────────────

export function exportKPIAsExcel(
  agentStats: { email: string; totalLeads: number; totalCheckins: number; levelACount: number; levelBCount: number; levelCCount: number }[],
  departmentStats?: { displayName: string; totalLeads: number; levelACount: number; checkinCount: number; agentCount: number }[]
) {
  if (agentStats.length === 0) return;

  const wb = XLSX.utils.book_new();

  // Agent stats sheet
  const agentData = agentStats.map((a, idx) => ({
    'အဆင့်': idx + 1,
    'ဝန်ထမ်း': a.email,
    'စုစုပေါင်း Leads': a.totalLeads,
    'Check-ins': a.totalCheckins,
    'Level A': a.levelACount,
    'Level B': a.levelBCount,
    'Level C': a.levelCCount,
    'Conversion Rate': a.totalLeads > 0 ? `${((a.levelACount / a.totalLeads) * 100).toFixed(1)}%` : '0%',
  }));
  const agentWs = XLSX.utils.json_to_sheet(agentData);
  XLSX.utils.book_append_sheet(wb, agentWs, 'ဝန်ထမ်း စွမ်းဆောင်ရည်');

  // Department stats sheet
  if (departmentStats && departmentStats.length > 0) {
    const deptData = departmentStats.map((d) => ({
      'ဌာန': d.displayName,
      'စုစုပေါင်း Leads': d.totalLeads,
      'Level A': d.levelACount,
      'Check-ins': d.checkinCount,
      'ဝန်ထမ်း အရေအတွက်': d.agentCount,
    }));
    const deptWs = XLSX.utils.json_to_sheet(deptData);
    XLSX.utils.book_append_sheet(wb, deptWs, 'ဌာန စွမ်းဆောင်ရည်');
  }

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, `PSM_KPI_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export function exportKPIAsPDF(
  agentStats: { email: string; totalLeads: number; totalCheckins: number; levelACount: number; levelBCount: number; levelCCount: number }[],
  departmentStats?: { displayName: string; totalLeads: number; levelACount: number; checkinCount: number; agentCount: number }[]
) {
  if (agentStats.length === 0) return;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.text('PSM Sale CRM - KPI Report', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, 25);

  // Department summary
  let startY = 32;
  if (departmentStats && departmentStats.length > 0) {
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('Department Summary', 14, startY);
    startY += 4;
    autoTable(doc, {
      startY,
      head: [['ဌာန', 'Leads', 'Level A', 'Check-ins', 'ဝန်ထမ်းများ']],
      body: departmentStats.map((d) => [d.displayName, String(d.totalLeads), String(d.levelACount), String(d.checkinCount), String(d.agentCount)]),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [4, 99, 202], textColor: [255, 255, 255], fontStyle: 'bold' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startY = (doc as any).lastAutoTable?.finalY + 10 || startY + 30;
  }

  // Agent performance
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text('Agent Performance', 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['#', 'ဝန်ထမ်း', 'Leads', 'Check-ins', 'Level A', 'Level B', 'Level C', 'Conversion']],
    body: agentStats.map((a, idx) => [
      String(idx + 1),
      a.email,
      String(a.totalLeads),
      String(a.totalCheckins),
      String(a.levelACount),
      String(a.levelBCount),
      String(a.levelCCount),
      a.totalLeads > 0 ? `${((a.levelACount / a.totalLeads) * 100).toFixed(1)}%` : '0%',
    ]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [4, 99, 202], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const blob = doc.output('blob');
  triggerDownload(blob, `PSM_KPI_Report_${new Date().toISOString().split('T')[0]}.pdf`);
}
