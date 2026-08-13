import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  SprintCompletionReport,
  SprintCompletionReportAssigneeRow,
  SprintCompletionReportDimensionRow,
  SprintCompletionReportProjectRow,
  SprintCompletionReportTicket,
} from "@/lib/sprint-completion-report-types";

interface AutoTableDoc extends jsPDF {
  lastAutoTable: { finalY: number };
}

function autoTableFinalY(doc: jsPDF): number {
  return (doc as AutoTableDoc).lastAutoTable.finalY;
}

export interface SprintCompletionReportPdfLabels {
  statusCompleted: string;
  completedOn: string;
  goals: string;
  velocity: string;
  plannedVsCompleted: string;
  carryover: string;
  projectsWorked: string;
  byProject: string;
  byAssignee: string;
  byType: string;
  byPriority: string;
  colProject: string;
  colAssignee: string;
  colType: string;
  colPriority: string;
  colTickets: string;
  colDone: string;
  colCompletedPts: string;
  colCarryoverPts: string;
  colRef: string;
  colTitle: string;
  colStoryPoints: string;
  doneTickets: string;
  carryoverTicketsHeading: string;
  unassignedProject: string;
  unassignedAssignee: string;
  pointsAbbr: string;
  carryoverTicketsCount: string;
}

export interface SprintCompletionReportPdfInput {
  sprintName: string;
  goals: string | null;
  report: SprintCompletionReport;
  labels: SprintCompletionReportPdfLabels;
  labelForType: (key: string) => string;
  labelForPriority: (key: string) => string;
}

const MARGIN = 14;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "sprint-report";
}

function projectRows(
  projects: SprintCompletionReportProjectRow[],
  unassignedLabel: string
): string[][] {
  return projects.map((p) => [
    p.projectId ? p.projectName : unassignedLabel,
    String(p.ticketCount),
    String(p.doneCount),
    String(p.velocityPoints),
    String(p.carryoverPoints),
  ]);
}

function assigneeRows(
  rows: SprintCompletionReportAssigneeRow[],
  unassignedLabel: string
): string[][] {
  return rows.map((a) => [
    a.userId ? a.assigneeLabel : unassignedLabel,
    String(a.ticketCount),
    String(a.doneCount),
    String(a.velocityPoints),
    String(a.carryoverPoints),
  ]);
}

function dimensionRows(
  rows: SprintCompletionReportDimensionRow[],
  labelForKey: (key: string) => string
): string[][] {
  return rows.map((r) => [
    labelForKey(r.key),
    String(r.ticketCount),
    String(r.doneCount),
    String(r.velocityPoints),
    String(r.carryoverPoints),
  ]);
}

function ticketListRows(
  tickets: SprintCompletionReportTicket[],
  unassignedProject: string,
  unassignedAssignee: string,
  pointsAbbr: string
): string[][] {
  return tickets.map((row) => [
    row.ref,
    row.title,
    row.projectId ? row.projectName : unassignedProject,
    row.assigneeId ? row.assigneeLabel : unassignedAssignee,
    row.storyPoints != null ? `${row.storyPoints} ${pointsAbbr}` : "—",
  ]);
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

export function downloadSprintCompletionReportPdf(input: SprintCompletionReportPdfInput): void {
  const { sprintName, goals, report, labels, labelForType, labelForPriority } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(31, 58, 95);
  doc.text(sprintName, MARGIN, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`${labels.statusCompleted} · ${labels.completedOn}`, MARGIN, y);
  y += 6;

  if (goals?.trim()) {
    const goalLines = doc.splitTextToSize(`${labels.goals}: ${goals.trim()}`, CONTENT_WIDTH);
    doc.text(goalLines, MARGIN, y);
    y += goalLines.length * 5 + 4;
  } else {
    y += 2;
  }

  const plannedValue =
    report.summary.pointsPlanned != null
      ? `${report.summary.velocityPoints} / ${report.summary.pointsPlanned}`
      : String(report.summary.velocityPoints);

  const statRows = [
    [labels.velocity, `${report.summary.velocityPoints} ${labels.pointsAbbr}`],
    [labels.plannedVsCompleted, plannedValue],
    [labels.carryover, `${report.summary.carryoverPoints} ${labels.pointsAbbr} (${labels.carryoverTicketsCount})`],
    [labels.projectsWorked, String(report.projects.length)],
  ];

  autoTable(doc, {
    startY: y,
    body: statRows,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 55 },
      1: { cellWidth: CONTENT_WIDTH - 55 },
    },
    theme: "plain",
  });
  y = autoTableFinalY(doc) + 10;

  const tableHeaders = [
    labels.colTickets,
    labels.colDone,
    labels.colCompletedPts,
    labels.colCarryoverPts,
  ];

  const addNamedSummaryTable = (
    title: string,
    nameHeader: string,
    body: string[][]
  ): void => {
    y = ensureSpace(doc, y, 24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text(title, MARGIN, y);

    autoTable(doc, {
      startY: y + 4,
      head: [[nameHeader, ...tableHeaders]],
      body,
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [31, 58, 95], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      theme: "grid",
    });
    y = autoTableFinalY(doc) + 8;
  };

  addNamedSummaryTable(
    labels.byProject,
    labels.colProject,
    projectRows(report.projects, labels.unassignedProject)
  );
  addNamedSummaryTable(
    labels.byAssignee,
    labels.colAssignee,
    assigneeRows(report.byAssignee, labels.unassignedAssignee)
  );
  addNamedSummaryTable(
    labels.byType,
    labels.colType,
    dimensionRows(report.byType, labelForType)
  );
  addNamedSummaryTable(
    labels.byPriority,
    labels.colPriority,
    dimensionRows(report.byPriority, labelForPriority)
  );

  const ticketListHead = [
    labels.colRef,
    labels.colTitle,
    labels.colProject,
    labels.colAssignee,
    labels.colStoryPoints,
  ];

  y = ensureSpace(doc, y, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(labels.doneTickets, MARGIN, y);

  autoTable(doc, {
    startY: y + 4,
    head: [ticketListHead],
    body: ticketListRows(
      report.doneTickets,
      labels.unassignedProject,
      labels.unassignedAssignee,
      labels.pointsAbbr
    ),
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 58, 95], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 16 },
      1: { cellWidth: 62 },
      2: { cellWidth: 32 },
      3: { cellWidth: 32 },
      4: { cellWidth: 18 },
    },
    theme: "grid",
  });
  y = autoTableFinalY(doc) + 8;

  if (report.carryoverTickets.length > 0) {
    y = ensureSpace(doc, y, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(labels.carryoverTicketsHeading, MARGIN, y);

    autoTable(doc, {
      startY: y + 4,
      head: [ticketListHead],
      body: ticketListRows(
        report.carryoverTickets,
        labels.unassignedProject,
        labels.unassignedAssignee,
        labels.pointsAbbr
      ),
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [120, 53, 15], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 16 },
        1: { cellWidth: 62 },
        2: { cellWidth: 32 },
        3: { cellWidth: 32 },
        4: { cellWidth: 18 },
      },
      theme: "grid",
    });
  }

  doc.save(`${sanitizeFilename(sprintName)}-sprint-report.pdf`);
}
