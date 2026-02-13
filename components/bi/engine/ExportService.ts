import html2canvas from 'html2canvas';
import { BIDashboard } from '../types';

type PdfOrientation = 'landscape' | 'portrait';

const safeFileName = (value: string, fallback: string) => {
    const normalized = String(value || fallback)
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_');
    return normalized || fallback;
};

const isTransparent = (color: string) => {
    if (!color) return true;
    const normalized = color.trim().toLowerCase();
    return normalized === 'transparent' || normalized === 'rgba(0, 0, 0, 0)' || normalized === 'rgba(0,0,0,0)';
};

const resolveBackgroundColor = (element: HTMLElement) => {
    let current: HTMLElement | null = element;
    while (current) {
        const bg = window.getComputedStyle(current).backgroundColor;
        if (!isTransparent(bg)) return bg;
        current = current.parentElement;
    }
    return '#020617';
};

const downloadDataUrl = (dataUrl: string, fileName: string) => {
    const link = document.createElement('a');
    link.download = fileName;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const captureDashboardCanvas = async (elementId: string): Promise<{ canvas: HTMLCanvasElement; fileNameBase: string } | null> => {
    if (typeof window === 'undefined') return null;

    const element = document.getElementById(elementId);
    if (!element) return null;

    const root = element as HTMLElement;
    const bgColor = resolveBackgroundColor(root);
    const fileNameBase = safeFileName(root.getAttribute('data-export-name') || 'dashboard', 'dashboard');
    const captureScale = Math.max(2, Math.min(3, window.devicePixelRatio || 2));

    if (document.fonts?.ready) {
        await document.fonts.ready;
    }

    const canvas = await html2canvas(root, {
        backgroundColor: bgColor,
        scale: captureScale,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width: root.scrollWidth,
        height: root.scrollHeight,
        windowWidth: root.scrollWidth,
        windowHeight: root.scrollHeight,
        onclone: (clonedDoc) => {
            const clonedRoot = clonedDoc.getElementById(elementId) as HTMLElement | null;
            if (!clonedRoot) return;

            clonedRoot.style.overflow = 'visible';
            clonedRoot.style.height = 'auto';
            clonedRoot.style.maxHeight = 'none';
            clonedRoot.style.backgroundColor = bgColor;

            const exportContent = clonedRoot.querySelector('[data-export-content="true"]') as HTMLElement | null;
            if (exportContent) {
                // Export should preserve dashboard layout, not current canvas zoom.
                exportContent.style.transform = 'none';
                exportContent.style.transformOrigin = 'top left';
            }

            const selectedHighlights = clonedRoot.querySelectorAll('.ring-2, .ring-indigo-500\\/50, .ring-yellow-500\\/50');
            selectedHighlights.forEach((node) => {
                const el = node as HTMLElement;
                el.style.boxShadow = 'none';
            });
        }
    });

    return { canvas, fileNameBase };
};

const exportPngInternal = (canvas: HTMLCanvasElement, fileName: string) => {
    const dataUrl = canvas.toDataURL('image/png');
    downloadDataUrl(dataUrl, `${safeFileName(fileName, 'dashboard')}.png`);
};

const exportPdfInternal = async (canvas: HTMLCanvasElement, fileName: string) => {
    const { jsPDF } = await import('jspdf');
    const orientation: PdfOrientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format: 'a4',
        compress: true
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 6;
    const printableWidth = pageWidth - margin * 2;
    const printableHeight = pageHeight - margin * 2;

    const pxPerMm = canvas.width / printableWidth;
    const pageCanvasHeight = Math.max(1, Math.floor(printableHeight * pxPerMm));

    let renderedPxHeight = 0;
    let pageIndex = 0;

    while (renderedPxHeight < canvas.height) {
        const sliceHeight = Math.min(pageCanvasHeight, canvas.height - renderedPxHeight);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeight;

        const ctx = pageCanvas.getContext('2d');
        if (!ctx) break;

        ctx.drawImage(
            canvas,
            0,
            renderedPxHeight,
            canvas.width,
            sliceHeight,
            0,
            0,
            canvas.width,
            sliceHeight
        );

        const imgData = pageCanvas.toDataURL('image/jpeg', 0.97);
        const renderedMmHeight = sliceHeight / pxPerMm;

        if (pageIndex > 0) {
            pdf.addPage();
        }

        pdf.addImage(
            imgData,
            'JPEG',
            margin,
            margin,
            printableWidth,
            renderedMmHeight,
            undefined,
            'FAST'
        );

        renderedPxHeight += sliceHeight;
        pageIndex += 1;
    }

    pdf.save(`${safeFileName(fileName, 'dashboard')}.pdf`);
};

export const ExportService = {
    exportToPDF: async (elementId: string, filename: string) => {
        try {
            const captured = await captureDashboardCanvas(elementId);
            if (!captured) return;
            await exportPdfInternal(captured.canvas, filename || captured.fileNameBase);
        } catch (error) {
            console.error('Export to PDF failed', error);
        }
    },

    exportToPNG: async (elementId: string, filename: string) => {
        try {
            const captured = await captureDashboardCanvas(elementId);
            if (!captured) return;
            exportPngInternal(captured.canvas, filename || captured.fileNameBase);
        } catch (error) {
            console.error('Export to PNG failed', error);
        }
    },

    exportToJSON: (dashboard: BIDashboard) => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dashboard, null, 2));
        const link = document.createElement('a');
        link.href = dataStr;
        link.download = `${dashboard.title.replace(/\s+/g, '_')}_export.json`;
        link.click();
    }
};
