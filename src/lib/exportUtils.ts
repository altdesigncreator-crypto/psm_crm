import { type Lead, LEAD_STAGES, LEAD_GRADES } from '@/types';
import { getDepartmentLabel } from '@/lib/permissions';
import type { Font, Workbook } from 'exceljs';

// Phone / email are deliberately left out of every lead export.
const EXPORT_HEADERS = [
  'Name', 'Location', 'Project', 'Budget', 'Status', 'Grade',
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

// ── Excel export ───────────────────────────────────────────────────────
// Built with exceljs (the community `xlsx` build can't write styles).
// A single data table with headers on row 1 — nothing above it — so the
// sheet sorts, filters, pivots and re-imports without any cleanup.

/** Neutral, Google-Workspace-like palette; colour is reserved for meaning. */
const XL = {
  accent: 'FF0463CA',
  ink: 'FF202124',
  inkSoft: 'FF5F6368',
  inkFaint: 'FF9AA0A6',
  line: 'FFE8EAED',
  headerBg: 'FFF1F3F4',
  danger: 'FFD93025',
};

/** [soft fill, strong text] — the "chip" look used for badges in the app. */
type Tone = [fill: string, text: string];
const NEUTRAL_TONE: Tone = ['FFF1F3F4', 'FF5F6368'];

const STAGE_TONES: Record<string, Tone> = {
  new: ['FFE8F0FE', 'FF1967D2'],
  contacted: ['FFE8EAF6', 'FF3949AB'],
  qualified: ['FFE0F7FA', 'FF00838F'],
  appointment: ['FFF3E8FD', 'FF8430CE'],
  site_visit: ['FFFCE8F3', 'FFC2185B'],
  negotiation: ['FFFEF7E0', 'FFB06000'],
  booking: ['FFFEEFE3', 'FFC5501E'],
  sold: ['FFE6F4EA', 'FF137333'],
  lost: NEUTRAL_TONE,
};

const GRADE_TONES: Record<string, Tone> = {
  A: ['FFFCE8E6', 'FFC5221F'],
  B: ['FFFEF7E0', 'FFB06000'],
  C: ['FFE8F0FE', 'FF1967D2'],
};
const GRADE_SHORT: Record<string, string> = { A: 'A · Hot', B: 'B · Warm', C: 'C · Cold' };

type XlValue = string | number | Date | null;
interface XlColumn {
  header: string;
  width: number;
  center?: boolean;
  value: (l: Lead, index: number) => XlValue;
}

/** Excel gets its own column order so a row reads left to right as
 * who → where they are in the pipeline → what they want → notes. */
const LEAD_XL_COLUMNS: XlColumn[] = [
  { header: '#', width: 6, center: true, value: (_, i) => i + 1 },
  { header: 'Name', width: 26, value: (l) => l.name },
  { header: 'Project', width: 24, value: (l) => l.preferred_project || null },
  { header: 'Location', width: 18, value: (l) => l.current_location || null },
  { header: 'Status', width: 15, center: true, value: (l) => stageLabel(l.status) },
  { header: 'Grade', width: 12, center: true, value: (l) => (l.lead_grade ? GRADE_SHORT[l.lead_grade] ?? l.lead_grade : null) },
  { header: 'Next Follow-up', width: 16, center: true, value: (l) => (l.next_follow_up_at ? new Date(l.next_follow_up_at) : null) },
  { header: 'Owner', width: 18, value: (l) => l.owner_name || null },
  { header: 'Source', width: 20, value: (l) => l.lead_source || null },
  { header: 'Department', width: 16, value: (l) => getDepartmentLabel(l.department_code) },
  { header: 'Interest', width: 12, value: (l) => l.interest_type || null },
  { header: 'Property Type', width: 15, value: (l) => l.property_type || null },
  { header: 'Budget', width: 26, value: (l) => l.budget_range || null },
  { header: 'Purpose', width: 22, value: (l) => l.purpose || null },
  { header: 'Remarks', width: 60, value: (l) => l.remarks || null },
];

const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const hairline = { style: 'thin' as const, color: { argb: XL.line } };
const xlFont = (o: Omit<Partial<Font>, 'color'> & { color?: string } = {}): Partial<Font> => ({
  size: 10,
  ...o,
  color: { argb: o.color ?? XL.ink },
});

/** exceljs serialises Dates as UTC; pin to the local calendar day so Excel
 * shows the same date the user sees in the app (Myanmar is UTC+6:30). */
const excelDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

function isOverdue(l: Lead, now: Date) {
  return !!l.next_follow_up_at && new Date(l.next_follow_up_at) < now && l.status !== 'sold' && l.status !== 'lost';
}

function buildLeadsSheet(wb: Workbook, leads: Lead[], now: Date) {
  const cols = LEAD_XL_COLUMNS;
  const ws = wb.addWorksheet('Leads', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: '1:1',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&L&8PSM Sale CRM · Leads&R&8Page &P of &N' },
  });
  ws.columns = cols.map((c) => ({ width: c.width }));

  const at = (header: string) => cols.findIndex((c) => c.header === header) + 1;
  const align = (c: XlColumn) => ({ vertical: 'middle' as const, horizontal: c.center ? ('center' as const) : ('left' as const), indent: c.center ? 0 : 1 });

  const header = ws.getRow(1);
  header.height = 28;
  cols.forEach((c, j) => {
    const h = header.getCell(j + 1);
    h.value = c.header;
    h.font = xlFont({ bold: true });
    h.fill = solid(XL.headerBg);
    h.alignment = align(c);
    h.border = { bottom: { style: 'medium', color: { argb: XL.accent } } };
  });

  leads.forEach((l, i) => {
    const row = ws.getRow(2 + i);
    row.height = 22;
    cols.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      const v = c.value(l, i);
      cell.value = v instanceof Date ? excelDay(v) : v;
      cell.font = xlFont();
      cell.alignment = align(c);
      cell.border = { bottom: hairline };
    });

    row.getCell(at('#')).font = xlFont({ color: XL.inkFaint });
    row.getCell(at('Name')).font = xlFont({ bold: true });
    row.getCell(at('Remarks')).font = xlFont({ color: XL.inkSoft });

    const chip = (header: string, [fill, text]: Tone) => {
      const cell = row.getCell(at(header));
      cell.fill = solid(fill);
      cell.font = xlFont({ bold: true, color: text });
    };
    chip('Status', STAGE_TONES[l.status] ?? NEUTRAL_TONE);
    if (l.lead_grade && GRADE_TONES[l.lead_grade]) chip('Grade', GRADE_TONES[l.lead_grade]);

    const follow = row.getCell(at('Next Follow-up'));
    follow.numFmt = 'd mmm yyyy';
    if (isOverdue(l, now)) follow.font = xlFont({ bold: true, color: XL.danger });
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + leads.length, column: cols.length } };
}

export async function exportAsExcel(leads: Lead[]) {
  if (leads.length === 0) return;
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const now = new Date();
  wb.creator = 'PSM Sale CRM';
  wb.title = 'Leads Export';
  wb.created = now;

  buildLeadsSheet(wb, leads, now);

  const buffer = await wb.xlsx.writeBuffer();
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
