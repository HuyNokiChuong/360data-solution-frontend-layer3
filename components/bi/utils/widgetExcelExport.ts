import * as XLSX from 'xlsx';
import { getFieldValue } from '../engine/utils';

export interface ExcelExportField {
    field: string;
    header?: string;
    candidates?: string[];
}

interface ExportRowsToExcelInput {
    title?: string;
    rows: Record<string, any>[];
    fields?: ExcelExportField[];
}

const INTERNAL_FIELDS = new Set(['_formattedAxis', '_combinedAxis', '_autoCategory']);

const normalizeToken = (value: string) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const toSafeFilename = (value: string) =>
    String(value || 'widget')
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 120) || 'widget';

const toSafeSheetName = (value: string) =>
    String(value || 'Data')
        .replace(/[\\/*?:\[\]]/g, ' ')
        .trim()
        .slice(0, 31) || 'Data';

const createTimestamp = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
};

const dedupeFields = (fields: ExcelExportField[]) => {
    const seen = new Set<string>();
    const output: ExcelExportField[] = [];

    fields.forEach((field) => {
        const key = `${field.field}::${field.header || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        output.push(field);
    });

    return output;
};

const inferFieldsFromRows = (rows: Record<string, any>[]): ExcelExportField[] => {
    const keyOrder = new Set<string>();
    rows.forEach((row) => {
        Object.keys(row || {}).forEach((key) => {
            if (!INTERNAL_FIELDS.has(key)) keyOrder.add(key);
        });
    });
    return Array.from(keyOrder).map((key) => ({ field: key, header: key }));
};

const resolveRowValue = (row: Record<string, any>, field: ExcelExportField) => {
    const candidates = [field.field, ...(field.candidates || [])]
        .filter(Boolean)
        .flatMap((item) => {
            const value = String(item);
            const leaf = value.includes('.') ? value.split('.').pop() : '';
            return leaf && leaf !== value ? [value, leaf] : [value];
        });

    for (const candidate of candidates) {
        if (row[candidate] !== undefined) return row[candidate];
        const resolved = getFieldValue(row, candidate);
        if (resolved !== undefined) return resolved;
    }

    const normalizedCandidates = new Set(candidates.map(normalizeToken));
    const fuzzyKey = Object.keys(row || {}).find((key) => normalizedCandidates.has(normalizeToken(key)));
    return fuzzyKey ? row[fuzzyKey] : undefined;
};

export const exportRowsToExcel = ({ title, rows, fields }: ExportRowsToExcelInput): boolean => {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const chosenFields = dedupeFields((fields && fields.length > 0) ? fields : inferFieldsFromRows(normalizedRows));

    if (chosenFields.length === 0) {
        return false;
    }

    const headerCounter = new Map<string, number>();
    const columns = chosenFields.map((field) => {
        const baseHeader = String(field.header || field.field || '').trim() || field.field;
        const count = headerCounter.get(baseHeader) || 0;
        headerCounter.set(baseHeader, count + 1);
        const header = count > 0 ? `${baseHeader} (${count + 1})` : baseHeader;
        return { ...field, header };
    });

    const exportRows = normalizedRows.map((row) => {
        const item: Record<string, any> = {};
        columns.forEach((column) => {
            item[column.header] = resolveRowValue(row, column);
        });
        return item;
    });

    const headerList = columns.map((column) => column.header);
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: headerList });
    if (exportRows.length === 0) {
        XLSX.utils.sheet_add_aoa(worksheet, [headerList], { origin: 'A1' });
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, toSafeSheetName(title || 'Data'));

    const fileName = `${toSafeFilename(title || 'widget')}_raw_${createTimestamp()}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    return true;
};

