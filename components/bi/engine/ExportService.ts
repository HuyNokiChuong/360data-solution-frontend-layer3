import html2canvas from 'html2canvas';
import { BIDashboard } from '../types';

export const ExportService = {
    exportToPDF: async (elementId: string, filename: string) => {
        // We import html2pdf dynamically because it might not be SSR friendly 
        // (though we are client side, it's safer)
        if (typeof window === 'undefined') return;

        const element = document.getElementById(elementId);
        if (!element) return;

        // html2pdf is often a global or specialized import. 
        // Since package.json has html2pdf.js, we assume it's available.
        // If TypeScript complains, we might need a declaration or use require.
        const html2pdf = (await import('html2pdf.js')).default;

        const opt = {
            margin: 10,
            filename: `${filename}.pdf`,
            image: { type: 'jpeg' as 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' as 'landscape' }
        };

        html2pdf().set(opt).from(element).save();
    },

    exportToPNG: async (elementId: string, filename: string) => {
        const element = document.getElementById(elementId);
        if (!element) return;

        try {
            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#0f172a' // Dashboard background color
            });

            const link = document.createElement('a');
            link.download = `${filename}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
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
