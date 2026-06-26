import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

interface AnalyticsData {
  totalLeads: number;
  closedCount: number;
  conversionRate: number;
  avgDealSize: number;
  statusLabels: string[];
  statusCounts: number[];
  agentPerf: [string, { total: number; closed: number }][];
  monthlyTrend: [string, { new: number; closed: number }][];
  sourceRevenue: [string, number][];
}

function getReportDate(): string {
  return new Date().toISOString().split('T')[0];
}

export function exportAnalyticsAsExcel(data: AnalyticsData) {
  const wb = XLSX.utils.book_new();

  // KPI Summary
  const kpiSheet = XLSX.utils.aoa_to_sheet([
    ['KPI', 'Value'],
    ['Total Leads', data.totalLeads],
    ['Closed Deals', data.closedCount],
    ['Conversion Rate', `${data.conversionRate}%`],
    ['Avg Deal Size', `$${data.avgDealSize.toLocaleString()}`],
  ]);
  XLSX.utils.book_append_sheet(wb, kpiSheet, 'KPI Summary');

  // Status Breakdown
  const statusSheet = XLSX.utils.aoa_to_sheet([
    ['Status', 'Count'],
    ...data.statusLabels.map((label, i) => [label, data.statusCounts[i]]),
  ]);
  XLSX.utils.book_append_sheet(wb, statusSheet, 'Status Breakdown');

  // Agent Performance
  const agentSheet = XLSX.utils.aoa_to_sheet([
    ['Agent', 'Total Leads', 'Closed', 'Conversion Rate'],
    ...data.agentPerf.map(([name, v]) => [
      name,
      v.total,
      v.closed,
      v.total > 0 ? `${((v.closed / v.total) * 100).toFixed(1)}%` : '0%',
    ]),
  ]);
  XLSX.utils.book_append_sheet(wb, agentSheet, 'Agent Performance');

  // Monthly Trend
  const trendSheet = XLSX.utils.aoa_to_sheet([
    ['Month', 'New Leads', 'Closed'],
    ...data.monthlyTrend.map(([month, v]) => [month, v.new, v.closed]),
  ]);
  XLSX.utils.book_append_sheet(wb, trendSheet, 'Monthly Trend');

  // Revenue by Source
  const revSheet = XLSX.utils.aoa_to_sheet([
    ['Source', 'Revenue'],
    ...data.sourceRevenue.map(([src, rev]) => [src, rev]),
  ]);
  XLSX.utils.book_append_sheet(wb, revSheet, 'Revenue by Source');

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, `PSM_Analytics_${getReportDate()}.xlsx`);
}

export function exportAnalyticsAsPDF(data: AnalyticsData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const dateStr = getReportDate();

  // Header
  doc.setFontSize(18);
  doc.setTextColor(4, 99, 202);
  doc.text('PSM Properties CRM', 14, 18);
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59);
  doc.text('Analytics Dashboard Report', 14, 26);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated: ${dateStr}  ·  Total Leads: ${data.totalLeads}`, 14, 32);

  let startY = 40;

  // KPI Summary Box
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, startY, 182, 22, 3, 3, 'F');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(`Conversion Rate: ${data.conversionRate}%    Closed: ${data.closedCount}    Avg Deal: $${data.avgDealSize.toLocaleString()}`, 18, startY + 9);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text('KPI Summary — based on current lead data', 18, startY + 16);
  startY += 30;

  // Status Breakdown
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text('Status Breakdown', 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Status', 'Count']],
    body: data.statusLabels.map((label, i) => [label, String(data.statusCounts[i])]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [4, 99, 202], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startY = (doc as any).lastAutoTable?.finalY + 10 || startY + 30;

  // Agent Performance
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text('Agent Performance', 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Agent', 'Total Leads', 'Closed', 'Conversion']],
    body: data.agentPerf.map(([name, v]) => [
      name,
      String(v.total),
      String(v.closed),
      v.total > 0 ? `${((v.closed / v.total) * 100).toFixed(1)}%` : '0%',
    ]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [4, 99, 202], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startY = (doc as any).lastAutoTable?.finalY + 10 || startY + 30;

  // Monthly Trend
  if (startY > 250) {
    doc.addPage();
    startY = 20;
  }
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text('Monthly Trend', 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Month', 'New Leads', 'Closed']],
    body: data.monthlyTrend.map(([month, v]) => [month, String(v.new), String(v.closed)]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [4, 99, 202], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startY = (doc as any).lastAutoTable?.finalY + 10 || startY + 30;

  // Revenue by Source
  if (startY > 240) {
    doc.addPage();
    startY = 20;
  }
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text('Revenue by Source', 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Source', 'Revenue']],
    body: data.sourceRevenue.map(([src, rev]) => [src, `$${rev.toLocaleString()}`]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [4, 99, 202], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  // Footer page number
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`PSM Properties CRM · Analytics Report · Page ${i} of ${pageCount}`, 14, doc.internal.pageSize.height - 10);
  }

  const blob = doc.output('blob');
  triggerDownload(blob, `PSM_Analytics_${dateStr}.pdf`);
}

export function exportAnalyticsAsHTML(data: AnalyticsData) {
  const dateStr = getReportDate();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PSM Properties CRM - Analytics Report</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #F8FAFC; color: #1e293b; padding: 32px; }
.container { max-width: 1200px; margin: 0 auto; }
.header { background: linear-gradient(135deg, #0463CA 0%, #0487E2 100%); color: #fff; padding: 28px; border-radius: 12px; margin-bottom: 24px; }
.header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.header p { font-size: 13px; opacity: 0.85; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
.kpi-card { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.kpi-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.kpi-value { font-size: 24px; font-weight: 700; color: #0f172a; }
.section { background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.section h2 { font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: #F1F5F9; color: #475569; font-weight: 600; text-align: left; padding: 12px 14px; border-bottom: 2px solid #E2E8F0; }
td { padding: 10px 14px; border-bottom: 1px solid #F1F5F9; }
tr:hover td { background: #F8FAFC; }
.footer { text-align: center; padding: 20px; font-size: 12px; color: #94A3B8; }
@media print { body { padding: 0; } .header { border-radius: 0; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>PSM Properties CRM</h1>
    <p>Analytics Dashboard Report &middot; ${dateStr} &middot; ${data.totalLeads} leads analyzed</p>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Leads</div>
      <div class="kpi-value">${data.totalLeads.toLocaleString()}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Conversion Rate</div>
      <div class="kpi-value">${data.conversionRate}%</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Avg Deal Size</div>
      <div class="kpi-value">$${data.avgDealSize.toLocaleString()}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Closed Deals</div>
      <div class="kpi-value">${data.closedCount.toLocaleString()}</div>
    </div>
  </div>

  <div class="section">
    <h2>Status Breakdown</h2>
    <table>
      <thead><tr><th>Status</th><th>Count</th></tr></thead>
      <tbody>
        ${data.statusLabels.map((label, i) => `<tr><td>${label}</td><td>${data.statusCounts[i]}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Agent Performance</h2>
    <table>
      <thead><tr><th>Agent</th><th>Total Leads</th><th>Closed</th><th>Conversion</th></tr></thead>
      <tbody>
        ${data.agentPerf.map(([name, v]) => {
          const rate = v.total > 0 ? ((v.closed / v.total) * 100).toFixed(1) : '0.0';
          return `<tr><td>${name}</td><td>${v.total}</td><td>${v.closed}</td><td>${rate}%</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Monthly Trend</h2>
    <table>
      <thead><tr><th>Month</th><th>New Leads</th><th>Closed</th></tr></thead>
      <tbody>
        ${data.monthlyTrend.map(([month, v]) => `<tr><td>${month}</td><td>${v.new}</td><td>${v.closed}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Revenue by Source</h2>
    <table>
      <thead><tr><th>Source</th><th>Revenue</th></tr></thead>
      <tbody>
        ${data.sourceRevenue.map(([src, rev]) => `<tr><td>${src}</td><td>$${rev.toLocaleString()}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="footer">Exported from PSM Properties CRM &middot; Analytics Dashboard</div>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `PSM_Analytics_${dateStr}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
