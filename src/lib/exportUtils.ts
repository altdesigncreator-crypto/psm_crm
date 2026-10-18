import { type Lead, LEAD_STAGES, LEAD_GRADES } from '@/types';
import { getDepartmentLabel } from '@/lib/permissions';

const EXPORT_HEADERS = [
  'Name', 'Phone', 'Email', 'Location', 'Project', 'Budget', 'Status', 'Grade',
  'Interest', 'Property Type', 'Purpose', 'Source', 'Owner', 'Next Follow-up', 'Department', 'Remarks',
];

function stageLabel(status: string) {
  return LEAD_STAGES.find((s) => s.value === status)?.label || status;
}

function gradeLabel(grade?: string | null) {
  return LEAD_GRADES.find((g) => g.value === grade)?.label || '';
}

function getLeadRow(l: Lead): string[] {
  return [
    l.name,
    l.phone,
    l.email || '',
    l.current_location || '',
    l.preferred_project || '',
    l.budget_range || '',
    stageLabel(l.status),
    gradeLabel(l.lead_grade),
    l.interest_type || '',
    l.property_type || '',
    l.purpose || '',
    l.lead_source || '',
    l.owner_name || '',
    l.next_follow_up_at ? new Date(l.next_follow_up_at).toLocaleDateString() : '',
    getDepartmentLabel(l.department_code),
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

export async function exportAsExcel(leads: Lead[]) {
  if (leads.length === 0) return;
  const XLSX = await import('xlsx');
  const data = leads.map((l) => {
    const row = getLeadRow(l);
    return Object.fromEntries(EXPORT_HEADERS.map((h, i) => [h, row[i]]));
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, getExportFileName('Leads', leads.length, 'xlsx'));
}

export async function exportAsPDF(leads: Lead[]) {
  if (leads.length === 0) return;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
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
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak', minCellHeight: 6 },
    headStyles: { fillColor: [4, 99, 202], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
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
  const rows = leads.map((l) => getLeadRow(l));
  const csvContent = [EXPORT_HEADERS, ...rows]
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
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, getExportFileName('Leads', leads.length, 'csv'));
}

export function exportAsHTML(leads: Lead[]) {
  if (leads.length === 0) return;
  const rows = leads.map((l) => getLeadRow(l));

  const html = `<!DOCTYPE html>
<html lang="en">
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

/** One leaderboard row (agent, team or department), money in MMK. */
export interface KpiExportRow {
  name: string;
  leads: number;
  sold: number;
  conversionRate: number | null;
  salesValue: number;
  companyIncome: number;
  agentCount?: number;
}

export interface KpiExportReport {
  /** Period + active filters, e.g. "October 2026 · Condo". */
  title: string;
  departments: KpiExportRow[];
  teams: KpiExportRow[];
  agents: KpiExportRow[];
}

const conversionCell = (r: KpiExportRow) => (r.conversionRate == null ? '—' : `${(r.conversionRate * 100).toFixed(1)}%`);
const mmk = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function kpiFileName(periodTitle: string, ext: string) {
  const slug = periodTitle.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `PSM_KPI_Report_${slug ? `${slug}_` : ''}${new Date().toISOString().split('T')[0]}.${ext}`;
}

interface KpiSection { title: string; nameHeader: string; rows: KpiExportRow[]; ranked: boolean; withAgents: boolean }

/** The report's tables, in display order — shared by the Excel and PDF
 * writers so both formats always carry the same sections and columns. */
function kpiSections(r: KpiExportReport): KpiSection[] {
  return [
    { title: 'Department Performance', nameHeader: 'Department', rows: r.departments, ranked: false, withAgents: true },
    { title: 'Team Performance', nameHeader: 'Team', rows: r.teams, ranked: true, withAgents: true },
    { title: 'Agent Performance', nameHeader: 'Agent', rows: r.agents, ranked: true, withAgents: false },
  ].filter((s) => s.rows.length > 0);
}

export async function exportKPIAsExcel(report: KpiExportReport) {
  if (report.agents.length === 0) return;
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // Money stays numeric (MMK) so the sheet can be summed / pivoted.
  for (const s of kpiSections(report)) {
    const data = s.rows.map((row, idx) => ({
      ...(s.ranked ? { Rank: idx + 1 } : {}),
      [s.nameHeader]: row.name,
      'New Leads': row.leads,
      Sold: row.sold,
      'Conversion Rate': conversionCell(row),
      'Sales Value (MMK)': row.salesValue,
      'Company Income (MMK)': row.companyIncome,
      ...(s.withAgents ? { Agents: row.agentCount ?? 0 } : {}),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), s.title);
  }

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, kpiFileName(report.title, 'xlsx'));
}

export async function exportKPIAsPDF(report: KpiExportReport) {
  if (report.agents.length === 0) return;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.text(`PSM Sale CRM - KPI Report${report.title ? ` (${report.title})` : ''}`, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated on ${new Date().toLocaleDateString()} · Amounts in MMK`, 14, 25);

  let startY = 32;
  for (const s of kpiSections(report)) {
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(s.title, 14, startY);
    autoTable(doc, {
      startY: startY + 4,
      head: [[...(s.ranked ? ['#'] : []), s.nameHeader, 'New Leads', 'Sold', 'Conversion', 'Sales Value', 'Company Income', ...(s.withAgents ? ['Agents'] : [])]],
      body: s.rows.map((row, idx) => [
        ...(s.ranked ? [String(idx + 1)] : []),
        row.name, String(row.leads), String(row.sold), conversionCell(row), mmk(row.salesValue), mmk(row.companyIncome),
        ...(s.withAgents ? [String(row.agentCount ?? 0)] : []),
      ]),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [4, 99, 202], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    startY = ((doc as any).lastAutoTable?.finalY ?? startY + 30) + 10;
  }

  const blob = doc.output('blob');
  triggerDownload(blob, kpiFileName(report.title, 'pdf'));
}
