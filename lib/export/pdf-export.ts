import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toPng } from 'html-to-image';
import type { DependencyExportData, ExportStats } from '@/types/export';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: typeof autoTable;
  }
}

/**
 * Exports a comprehensive dependency report as a professional PDF
 * @param dependencies - Array of dependency data
 * @param stats - Statistics for the report
 * @param graphElement - The HTML element containing the graph to embed
 */
export async function exportDependencyReport(
  dependencies: DependencyExportData[],
  stats: ExportStats,
  graphElement: HTMLElement | null
): Promise<void> {
  try {
    // Initialize PDF with Letter size
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'in',
      format: 'letter',
    });

    const pageWidth = 8.5;
    const pageHeight = 11;
    const margin = 0.75;
    const contentWidth = pageWidth - margin * 2;

    // Color scheme
    const primaryBlue = '#2563eb';
    const darkGray = '#1f2937';
    const lightGray = '#6b7280';
    const bgGray = '#f3f4f6';

    let yPosition = margin;

    // ==========================
    // 1. COVER PAGE
    // ==========================

    // Title
    doc.setFontSize(32);
    doc.setTextColor(primaryBlue);
    doc.setFont('helvetica', 'bold');
    doc.text('Service Dependencies', margin, yPosition + 0.5);

    yPosition += 1;
    doc.setFontSize(24);
    doc.setTextColor(darkGray);
    doc.text('Architecture Report', margin, yPosition);

    // Date and metadata
    yPosition += 1.5;
    doc.setFontSize(12);
    doc.setTextColor(lightGray);
    doc.setFont('helvetica', 'normal');
    const reportDate = new Date(stats.exportDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.text(`Generated: ${reportDate}`, margin, yPosition);

    yPosition += 0.3;
    doc.text(`Total Services: ${stats.totalServices}`, margin, yPosition);

    yPosition += 0.3;
    doc.text(`Total Dependencies: ${stats.totalDependencies}`, margin, yPosition);

    // DevControl branding
    yPosition = pageHeight - margin - 0.5;
    doc.setFontSize(10);
    doc.setTextColor(lightGray);
    doc.text('DevControl - Service Dependency Management', margin, yPosition);
    doc.text('https://devcontrol.io', margin, yPosition + 0.2);

    // ==========================
    // 2. EXECUTIVE SUMMARY
    // ==========================

    doc.addPage();
    yPosition = margin;

    doc.setFontSize(20);
    doc.setTextColor(primaryBlue);
    doc.setFont('helvetica', 'bold');
    doc.text('Executive Summary', margin, yPosition);

    yPosition += 0.5;
    doc.setFontSize(11);
    doc.setTextColor(darkGray);
    doc.setFont('helvetica', 'normal');

    // Stats cards layout
    const cardWidth = contentWidth / 2 - 0.1;
    const cardHeight = 0.8;
    let cardX = margin;
    let cardY = yPosition;

    // Helper to draw stat card
    const drawStatCard = (x: number, y: number, label: string, value: string, color: string) => {
      // Background
      doc.setFillColor(bgGray);
      doc.rect(x, y, cardWidth, cardHeight, 'F');

      // Border
      doc.setDrawColor(color);
      doc.setLineWidth(0.02);
      doc.rect(x, y, cardWidth, cardHeight);

      // Label
      doc.setFontSize(10);
      doc.setTextColor(lightGray);
      doc.text(label, x + 0.15, y + 0.3);

      // Value
      doc.setFontSize(20);
      doc.setTextColor(darkGray);
      doc.setFont('helvetica', 'bold');
      doc.text(value, x + 0.15, y + 0.6);
      doc.setFont('helvetica', 'normal');
    };

    // Draw stat cards
    drawStatCard(cardX, cardY, 'Total Services', stats.totalServices.toString(), primaryBlue);
    drawStatCard(cardX + cardWidth + 0.2, cardY, 'Total Dependencies', stats.totalDependencies.toString(), primaryBlue);

    cardY += cardHeight + 0.2;
    drawStatCard(cardX, cardY, 'Critical Paths', stats.criticalPaths.toString(), stats.criticalPaths > 0 ? '#ef4444' : '#10b981');
    drawStatCard(cardX + cardWidth + 0.2, cardY, 'Circular Dependencies', stats.circularDependencies.toString(), stats.circularDependencies > 0 ? '#ef4444' : '#10b981');

    yPosition = cardY + cardHeight + 0.5;

    // Key insights
    doc.setFontSize(14);
    doc.setTextColor(primaryBlue);
    doc.setFont('helvetica', 'bold');
    doc.text('Key Insights', margin, yPosition);

    yPosition += 0.3;
    doc.setFontSize(11);
    doc.setTextColor(darkGray);
    doc.setFont('helvetica', 'normal');

    const insights: string[] = [];

    if (stats.criticalPaths > 0) {
      insights.push(`⚠ ${stats.criticalPaths} critical path dependencies require immediate attention`);
    }

    if (stats.circularDependencies > 0) {
      insights.push(`⚠ ${stats.circularDependencies} circular dependency cycles detected - may cause deployment issues`);
    } else {
      insights.push('✓ No circular dependencies detected - architecture is healthy');
    }

    const avgDepsPerService = (stats.totalDependencies / stats.totalServices).toFixed(1);
    insights.push(`• Average dependencies per service: ${avgDepsPerService}`);

    insights.forEach((insight) => {
      doc.text(insight, margin + 0.2, yPosition);
      yPosition += 0.25;
    });

    // ==========================
    // 3. DEPENDENCY GRAPH
    // ==========================

    if (graphElement) {
      doc.addPage();
      yPosition = margin;

      doc.setFontSize(20);
      doc.setTextColor(primaryBlue);
      doc.setFont('helvetica', 'bold');
      doc.text('Dependency Graph', margin, yPosition);

      yPosition += 0.4;

      try {
        // Capture graph as PNG
        const graphDataUrl = await captureGraphForPDF(graphElement);

        // Calculate dimensions to fit page
        const graphWidth = contentWidth;
        const graphHeight = 5; // Adjust as needed

        doc.addImage(graphDataUrl, 'PNG', margin, yPosition, graphWidth, graphHeight);

        yPosition += graphHeight + 0.3;
      } catch (error) {
        console.error('Failed to embed graph:', error);
        doc.setFontSize(11);
        doc.setTextColor(lightGray);
        doc.text('(Graph could not be embedded in this report)', margin, yPosition);
        yPosition += 0.5;
      }
    }

    // ==========================
    // 4. DEPENDENCY TABLE
    // ==========================

    doc.addPage();
    yPosition = margin;

    doc.setFontSize(20);
    doc.setTextColor(primaryBlue);
    doc.setFont('helvetica', 'bold');
    doc.text('Dependency Details', margin, yPosition);

    yPosition += 0.5;

    // Prepare table data
    const tableData = dependencies.map((dep) => [
      dep.serviceName,
      dep.dependsOn,
      dep.type,
      dep.isCriticalPath ? 'Yes' : 'No',
      dep.tags.join(', '),
    ]);

    // Add table using autotable
    autoTable(doc, {
      startY: yPosition,
      head: [['Service', 'Depends On', 'Type', 'Critical', 'Tags']],
      body: tableData,
      theme: 'grid',
      headStyles: {
        fillColor: primaryBlue,
        textColor: '#ffffff',
        fontStyle: 'bold',
        fontSize: 10,
      },
      bodyStyles: {
        fontSize: 9,
        textColor: darkGray,
      },
      alternateRowStyles: {
        fillColor: bgGray,
      },
      margin: { left: margin, right: margin },
      didDrawPage: (data) => {
        // Add page numbers
        addPageNumber(doc, data.pageNumber);
      },
    });

    // ==========================
    // 5. CIRCULAR DEPENDENCIES
    // ==========================

    if (stats.circularDependencies > 0) {
      doc.addPage();
      yPosition = margin;

      doc.setFontSize(20);
      doc.setTextColor('#ef4444');
      doc.setFont('helvetica', 'bold');
      doc.text('⚠ Circular Dependencies', margin, yPosition);

      yPosition += 0.4;
      doc.setFontSize(11);
      doc.setTextColor(darkGray);
      doc.setFont('helvetica', 'normal');
      doc.text(
        'Circular dependencies can cause deployment issues, infinite loops, and cascading failures.',
        margin,
        yPosition,
        { maxWidth: contentWidth }
      );

      yPosition += 0.5;
      doc.setFontSize(12);
      doc.setTextColor(primaryBlue);
      doc.setFont('helvetica', 'bold');
      doc.text('Recommended Actions:', margin, yPosition);

      yPosition += 0.3;
      doc.setFontSize(11);
      doc.setTextColor(darkGray);
      doc.setFont('helvetica', 'normal');

      const recommendations = [
        '1. Identify and break circular dependencies by introducing mediator services',
        '2. Use event-driven architecture to decouple tightly-coupled services',
        '3. Review service boundaries and consider domain-driven design principles',
        '4. Implement dependency injection to reduce tight coupling',
      ];

      recommendations.forEach((rec) => {
        doc.text(rec, margin + 0.2, yPosition, { maxWidth: contentWidth - 0.2 });
        yPosition += 0.3;
      });
    }

    // Add page numbers to all pages
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      addPageNumber(doc, i, totalPages);
    }

    // Generate filename and download
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const filename = `devcontrol-dependency-report-${timestamp}.pdf`;

    doc.save(filename);

    console.log(`PDF report exported successfully: ${filename}`);
  } catch (error) {
    console.error('PDF export failed:', error);
    throw new Error(
      `Failed to export dependency report: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Captures the graph element as PNG for embedding in PDF
 */
async function captureGraphForPDF(graphElement: HTMLElement): Promise<string> {
  // Store original styles
  const originalBackground = graphElement.style.backgroundColor;

  // Hide controls
  const controls = graphElement.querySelectorAll('.react-flow__controls, .react-flow__panel');
  const controlsOriginalDisplay: string[] = [];
  controls.forEach((control, index) => {
    controlsOriginalDisplay[index] = (control as HTMLElement).style.display;
    (control as HTMLElement).style.display = 'none';
  });

  // Apply white background
  graphElement.style.backgroundColor = '#ffffff';

  try {
    // Capture at lower resolution for PDF embedding
    const dataUrl = await toPng(graphElement, {
      cacheBust: true,
      quality: 0.95,
      pixelRatio: 1.5,
      backgroundColor: '#ffffff',
    });

    return dataUrl;
  } finally {
    // Restore original styles
    graphElement.style.backgroundColor = originalBackground;
    controls.forEach((control, index) => {
      (control as HTMLElement).style.display = controlsOriginalDisplay[index];
    });
  }
}

/**
 * Adds page number footer to PDF
 */
function addPageNumber(doc: jsPDF, currentPage: number, totalPages?: number) {
  const pageHeight = 11;
  const margin = 0.75;

  doc.setFontSize(9);
  doc.setTextColor('#6b7280');
  doc.setFont('helvetica', 'normal');

  const pageText = totalPages ? `Page ${currentPage} of ${totalPages}` : `Page ${currentPage}`;
  const textWidth = doc.getTextWidth(pageText);

  // Center the page number
  doc.text(pageText, (8.5 - textWidth) / 2, pageHeight - margin / 2);
}
