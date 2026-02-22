const path = require('path');
const XLSX = require('xlsx');

const MAX_EXCEL_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls']);
const XLSX_ZIP_SIGNATURES = [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
];
const XLS_CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const createValidationError = (message, details) => {
    const error = new Error(message);
    error.code = 'EXCEL_VALIDATION_ERROR';
    if (details) error.details = details;
    return error;
};

const hasPrefix = (buffer, signature) => {
    if (!buffer || buffer.length < signature.length) return false;
    for (let i = 0; i < signature.length; i += 1) {
        if (buffer[i] !== signature[i]) return false;
    }
    return true;
};

const looksLikeZip = (buffer) => XLSX_ZIP_SIGNATURES.some((sig) => hasPrefix(buffer, sig));

const looksLikeSpreadsheetXml = (buffer) => {
    if (!buffer || buffer.length === 0) return false;
    const sample = buffer.slice(0, 512).toString('utf8').trimStart();
    if (!sample.startsWith('<')) return false;
    const lowered = sample.toLowerCase();
    return lowered.includes('workbook') || lowered.includes('spreadsheet');
};

const validateExcelBinarySignature = (fileName, buffer) => {
    const ext = path.extname(fileName).toLowerCase();
    const isZip = looksLikeZip(buffer);
    const isXlsCfb = hasPrefix(buffer, XLS_CFB_SIGNATURE);
    const isSpreadsheetXml = looksLikeSpreadsheetXml(buffer);

    if (ext === '.xlsx' && !isZip) {
        throw createValidationError('File .xlsx không hợp lệ hoặc bị hỏng');
    }

    if (ext === '.xls' && !isXlsCfb && !isSpreadsheetXml && !isZip) {
        throw createValidationError('File .xls không hợp lệ hoặc bị hỏng');
    }
};

const normalizeHeaderCell = (value) => {
    if (value === null || value === undefined) return '';
    return String(value);
};

const detectCellType = (value) => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return 'date';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'string';
    return 'string';
};

const readWorkbook = (buffer) => {
    try {
        return XLSX.read(buffer, {
            type: 'buffer',
            raw: true,
            cellDates: false,
            cellText: false,
            dense: false,
        });
    } catch (err) {
        throw createValidationError('File Excel không hợp lệ hoặc bị hỏng', { cause: err.message });
    }
};

const validateExcelFile = (fileName, buffer) => {
    if (!fileName) {
        throw createValidationError('Thiếu tên file Excel');
    }

    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw createValidationError('Định dạng file không được hỗ trợ. Chỉ chấp nhận .xlsx hoặc .xls');
    }

    if (!buffer || buffer.length === 0) {
        throw createValidationError('File upload rỗng hoặc không hợp lệ');
    }

    if (buffer.length > MAX_EXCEL_FILE_SIZE_BYTES) {
        throw createValidationError('File vượt quá giới hạn 50MB');
    }

    validateExcelBinarySignature(fileName, buffer);
};

const parseSheet = (sheet, sheetName) => {
    const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: true,
    });

    if (!matrix.length) {
        return {
            sheetName,
            headers: [],
            rows: [],
            rowCount: 0,
            columnCount: 0,
            isEmpty: true,
            schema: [],
            warnings: [`Sheet "${sheetName}" rỗng`],
        };
    }

    const headerRow = Array.isArray(matrix[0]) ? matrix[0] : [];
    const headers = headerRow.map(normalizeHeaderCell);
    const normalizedHeaders = headers.map((h) => h.trim());

    if (!headers.length || normalizedHeaders.every((h) => h === '')) {
        return {
            sheetName,
            headers: [],
            rows: [],
            rowCount: 0,
            columnCount: 0,
            isEmpty: true,
            schema: [],
            warnings: [`Sheet "${sheetName}" không có header hợp lệ`],
        };
    }

    const blankHeaderIndex = normalizedHeaders.findIndex((h) => h === '');
    if (blankHeaderIndex !== -1) {
        throw createValidationError(
            `Header không hợp lệ tại sheet "${sheetName}"`,
            { sheetName, columnIndex: blankHeaderIndex + 1, reason: 'Header trống' }
        );
    }

    const duplicateMap = new Set();
    for (let i = 0; i < headers.length; i++) {
        if (duplicateMap.has(headers[i])) {
            throw createValidationError(
                `Header bị trùng tại sheet "${sheetName}"`,
                { sheetName, columnName: headers[i], columnIndex: i + 1, reason: 'Duplicate header' }
            );
        }
        duplicateMap.add(headers[i]);
    }

    const dataRows = matrix.slice(1).map((rowValues) => {
        const rowArray = Array.isArray(rowValues) ? rowValues : [];
        const rowData = {};

        headers.forEach((header, index) => {
            const rawValue = index < rowArray.length ? rowArray[index] : null;
            rowData[header] = rawValue === undefined ? null : rawValue;
        });

        return rowData;
    });

    const detectedTypes = headers.map(() => null);
    dataRows.forEach((row) => {
        headers.forEach((header, index) => {
            const nextType = detectCellType(row[header]);
            if (!nextType) return;
            if (!detectedTypes[index]) {
                detectedTypes[index] = nextType;
                return;
            }
            if (detectedTypes[index] !== nextType) {
                detectedTypes[index] = 'mixed';
            }
        });
    });

    const schema = headers.map((header, index) => ({
        name: header,
        type: detectedTypes[index] || 'unknown',
    }));

    const isEmpty = dataRows.length === 0 || dataRows.every((row) =>
        headers.every((header) => row[header] === null || row[header] === '')
    );

    return {
        sheetName,
        headers,
        rows: dataRows,
        rowCount: dataRows.length,
        columnCount: headers.length,
        isEmpty,
        schema,
        warnings: isEmpty ? [`Sheet "${sheetName}" rỗng`] : [],
    };
};

const parseWorkbookForPreview = ({ buffer, fileName }) => {
    validateExcelFile(fileName, buffer);
    const workbook = readWorkbook(buffer);
    const sheetNames = workbook.SheetNames || [];

    if (sheetNames.length === 0) {
        throw createValidationError('File Excel không chứa sheet nào');
    }

    const sheets = sheetNames.map((sheetName) => {
        const parsed = parseSheet(workbook.Sheets[sheetName], sheetName);
        return {
            sheetName: parsed.sheetName,
            rowCount: parsed.rowCount,
            columnCount: parsed.columnCount,
            isEmpty: parsed.isEmpty,
            warnings: parsed.warnings,
        };
    });

    return {
        fileName,
        sheetCount: sheets.length,
        sheets,
    };
};

const parseWorkbookForImport = ({ buffer, fileName, selectedSheetNames }) => {
    validateExcelFile(fileName, buffer);
    const workbook = readWorkbook(buffer);
    const availableSheetNames = new Set(workbook.SheetNames || []);

    if (!Array.isArray(selectedSheetNames) || selectedSheetNames.length === 0) {
        throw createValidationError('Bạn phải chọn ít nhất 1 sheet để import');
    }

    const missingSheets = selectedSheetNames.filter((name) => !availableSheetNames.has(name));
    if (missingSheets.length > 0) {
        throw createValidationError('Danh sách sheet không hợp lệ', { missingSheets });
    }

    const sheets = selectedSheetNames.map((sheetName) => {
        const parsed = parseSheet(workbook.Sheets[sheetName], sheetName);
        return parsed;
    });

    return {
        fileName,
        sheetCount: sheets.length,
        sheets,
    };
};

const chunkArray = (arr, chunkSize) => {
    if (!Array.isArray(arr) || chunkSize <= 0) return [];
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
};

module.exports = {
    MAX_EXCEL_FILE_SIZE_BYTES,
    parseWorkbookForPreview,
    parseWorkbookForImport,
    chunkArray,
    createValidationError,
};
