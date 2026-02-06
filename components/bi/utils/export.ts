
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { BIDashboard } from '../types';

/**
 * Export dashboard as JSON
 */
export function exportAsJSON(dashboard: BIDashboard): void {
    const json = JSON.stringify(dashboard, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${dashboard.title.replace(/\s+/g, '_')}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Export dashboard as PNG
 */
export async function exportAsPNG(elementId: string, filename?: string): Promise<void> {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error('Element not found for export');
        return;
    }

    try {
        const canvas = await html2canvas(element, {
            backgroundColor: '#0f172a',
            scale: 2,
            logging: false,
            useCORS: true
        });

        const link = document.createElement('a');
        link.download = filename || `dashboard_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('PNG export failed:', error);
        throw error;
    }
}

/**
 * Export dashboard as PDF
 */
export async function exportAsPDF(elementId: string, filename?: string): Promise<void> {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error('Element not found for export');
        return;
    }

    try {
        const canvas = await html2canvas(element, {
            backgroundColor: '#0f172a',
            scale: 2,
            logging: false,
            useCORS: true
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
            orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height]
        });

        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(filename || `dashboard_${Date.now()}.pdf`);
    } catch (error) {
        console.error('PDF export failed:', error);
        throw error;
    }
}

/**
 * Save dashboard to localStorage
 */
export function saveDashboardToLocal(dashboard: BIDashboard): void {
    try {
        const dashboards = loadDashboardsFromLocal();
        const existingIndex = dashboards.findIndex(d => d.id === dashboard.id);

        if (existingIndex >= 0) {
            dashboards[existingIndex] = dashboard;
        } else {
            dashboards.push(dashboard);
        }

        localStorage.setItem('bi_dashboards', JSON.stringify(dashboards));
    } catch (error) {
        console.error('Failed to save dashboard:', error);
        throw error;
    }
}

/**
 * Load dashboards from localStorage
 */
export function loadDashboardsFromLocal(): BIDashboard[] {
    try {
        const stored = localStorage.getItem('bi_dashboards');
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Failed to load dashboards:', error);
        return [];
    }
}

/**
 * Delete dashboard from localStorage
 */
export function deleteDashboardFromLocal(dashboardId: string): void {
    try {
        const dashboards = loadDashboardsFromLocal();
        const filtered = dashboards.filter(d => d.id !== dashboardId);
        localStorage.setItem('bi_dashboards', JSON.stringify(filtered));
    } catch (error) {
        console.error('Failed to delete dashboard:', error);
        throw error;
    }
}
