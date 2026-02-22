const GOOGLE_SHEETS_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';

const DEFAULT_GOOGLE_SHEETS_QUOTA = {
    maxTotalCells: Number(process.env.MAX_TOTAL_CELLS_PER_IMPORT || 2_000_000),
    maxRowsPerSheet: Number(process.env.MAX_ROWS_PER_SHEET || 100_000),
    maxSheetsPerImport: Number(process.env.MAX_SHEETS_PER_IMPORT || 100),
};

const chunkArray = (arr, chunkSize) => {
    if (!Array.isArray(arr) || chunkSize <= 0) return [];
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
};

const createGoogleSheetsError = (message, details) => {
    const error = new Error(message);
    error.code = 'GOOGLE_SHEETS_ERROR';
    if (details) error.details = details;
    return error;
};

const escapeDriveQueryText = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const parseSpreadsheetIdFromUrl = (rawUrl) => {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
        const url = new URL(rawUrl.trim());
        if (!url.hostname.includes('docs.google.com')) return null;
        const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : null;
    } catch (err) {
        return null;
    }
};

const googleApiRequest = async (url, accessToken, options = {}) => {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(options.headers || {}),
        },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw createGoogleSheetsError('Google API request failed', {
            status: response.status,
            statusText: response.statusText,
            payload,
        });
    }
    return payload;
};

const listSpreadsheetFiles = async (accessToken, params = {}) => {
    const search = typeof params.search === 'string' ? params.search.trim() : '';
    const pageToken = params.pageToken ? String(params.pageToken) : '';
    const pageSizeRaw = Number(params.pageSize || 25);
    const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 1), 100) : 25;

    let q = `mimeType='${GOOGLE_SHEETS_MIME_TYPE}' and trashed=false`;
    if (search) q += ` and name contains '${escapeDriveQueryText(search)}'`;

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', q);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress))');
    url.searchParams.set('orderBy', 'modifiedTime desc,name');
    url.searchParams.set('pageSize', String(pageSize));
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const data = await googleApiRequest(url.toString(), accessToken);
    return {
        nextPageToken: data.nextPageToken || null,
        files: (data.files || []).map((file) => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime,
            owners: Array.isArray(file.owners) ? file.owners : [],
        })),
    };
};

const getSpreadsheetFileMetadata = async (accessToken, fileId) => {
    const id = String(fileId || '').trim();
    if (!id) throw createGoogleSheetsError('fileId is required');
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('fields', 'id,name,mimeType,modifiedTime');

    const file = await googleApiRequest(url.toString(), accessToken);
    if (file.mimeType !== GOOGLE_SHEETS_MIME_TYPE) {
        throw createGoogleSheetsError('File is not a Google Spreadsheet', { fileId: id, mimeType: file.mimeType });
    }

    return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
    };
};

const resolveSpreadsheetUrl = async (accessToken, url) => {
    const spreadsheetId = parseSpreadsheetIdFromUrl(url);
    if (!spreadsheetId) {
        throw createGoogleSheetsError('Invalid Google Sheets URL');
    }
    return getSpreadsheetFileMetadata(accessToken, spreadsheetId);
};

const listSpreadsheetSheets = async (accessToken, fileId) => {
    const id = String(fileId || '').trim();
    if (!id) throw createGoogleSheetsError('fileId is required');
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`);
    url.searchParams.set(
        'fields',
        'spreadsheetId,properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))'
    );

    const data = await googleApiRequest(url.toString(), accessToken);
    return {
        spreadsheetId: data.spreadsheetId,
        title: data?.properties?.title || '',
        sheets: (data.sheets || []).map((sheet) => ({
            sheetId: sheet?.properties?.sheetId,
            title: sheet?.properties?.title || '',
            index: sheet?.properties?.index ?? 0,
            gridProperties: {
                rowCount: sheet?.properties?.gridProperties?.rowCount ?? 0,
                columnCount: sheet?.properties?.gridProperties?.columnCount ?? 0,
            },
        })),
    };
};

const encodeSheetRange = (sheetTitle) => {
    const escaped = String(sheetTitle || '').replace(/'/g, "''");
    return `'${escaped}'`;
};

const fetchSheetValuesRaw = async (accessToken, fileId, sheetTitle) => {
    const spreadsheetId = String(fileId || '').trim();
    if (!spreadsheetId) throw createGoogleSheetsError('fileId is required');
    const range = encodeSheetRange(sheetTitle);

    const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
    );
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
    url.searchParams.set('dateTimeRenderOption', 'SERIAL_NUMBER');
    url.searchParams.set('majorDimension', 'ROWS');

    const data = await googleApiRequest(url.toString(), accessToken);
    return {
        range: data.range,
        values: Array.isArray(data.values) ? data.values : [],
    };
};

const normalizeCell = (value) => (value === undefined ? null : value);

const normalizeHeaderCell = (value) => {
    if (value === null || value === undefined) return '';
    return String(value);
};

const isHeaderValid = (headers, expectedColumnCount) => {
    if (!Array.isArray(headers) || headers.length === 0) return false;
    if (Number.isFinite(expectedColumnCount) && headers.length !== expectedColumnCount) return false;
    const hasBlank = headers.some((h) => h === '');
    if (hasBlank) return false;
    const uniq = new Set(headers);
    return uniq.size === headers.length;
};

const rowIsBlank = (row) => {
    if (!Array.isArray(row)) return true;
    return row.every((value) => value === null || value === undefined || value === '');
};

const normalizeSheetForImport = ({ sheetInfo, valuesRows, headerMode = 'first_row', strictHeader = true }) => {
    const rows = Array.isArray(valuesRows) ? valuesRows : [];
    const firstRow = Array.isArray(rows[0]) ? rows[0] : [];
    const firstRowHeaders = firstRow.map(normalizeHeaderCell);

    const maxColumns = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    const effectiveColumns = Math.max(maxColumns, firstRowHeaders.length);
    const hasValidHeader = isHeaderValid(firstRowHeaders, effectiveColumns);

    const requiresHeaderDecision = !hasValidHeader;
    if (headerMode === 'first_row' && requiresHeaderDecision && strictHeader) {
        throw createGoogleSheetsError('Sheet does not have a valid header row', {
            sheetId: sheetInfo.sheetId,
            sheetName: sheetInfo.title,
            code: 'HEADER_REQUIRED',
        });
    }

    let headers = [];
    let dataRows = [];
    if (headerMode === 'first_row' && hasValidHeader) {
        headers = firstRowHeaders;
        dataRows = rows.slice(1);
    } else if (headerMode === 'auto_columns') {
        headers = Array.from({ length: effectiveColumns }, (_, i) => `Column_${i + 1}`);
        dataRows = rows;
    } else {
        headers = firstRowHeaders;
        dataRows = rows.slice(1);
    }

    const columnCount = headers.length || effectiveColumns;
    const safeHeaders = headers.length > 0
        ? headers
        : Array.from({ length: columnCount }, (_, i) => `Column_${i + 1}`);

    const rowObjects = dataRows.map((row) => {
        const rowArray = Array.isArray(row) ? row : [];
        const rowData = {};
        for (let i = 0; i < safeHeaders.length; i += 1) {
            const header = safeHeaders[i];
            const value = i < rowArray.length ? normalizeCell(rowArray[i]) : null;
            rowData[header] = value;
        }
        return rowData;
    });

    const isEmpty = rowObjects.length === 0 || rowObjects.every((row) =>
        safeHeaders.every((header) => row[header] === null || row[header] === '')
    );

    return {
        sheetId: sheetInfo.sheetId,
        sheetName: sheetInfo.title,
        headerMode,
        hasValidHeader,
        requiresHeaderDecision,
        headers: safeHeaders,
        rowCount: rowObjects.length,
        columnCount: safeHeaders.length,
        rows: rowObjects,
        isEmpty,
        schema: safeHeaders.map((name) => ({ name, type: 'unknown' })),
        sampleHeader: firstRowHeaders,
    };
};

const validateImportQuotas = (preparedSheets, quota = DEFAULT_GOOGLE_SHEETS_QUOTA) => {
    if (!Array.isArray(preparedSheets)) return;
    if (preparedSheets.length > quota.maxSheetsPerImport) {
        throw createGoogleSheetsError('Sheet selection exceeds quota', {
            maxSheetsPerImport: quota.maxSheetsPerImport,
            selectedSheets: preparedSheets.length,
        });
    }

    let totalCells = 0;
    for (const sheet of preparedSheets) {
        if (sheet.rowCount > quota.maxRowsPerSheet) {
            throw createGoogleSheetsError('Sheet row count exceeds quota', {
                sheetName: sheet.sheetName,
                rowCount: sheet.rowCount,
                maxRowsPerSheet: quota.maxRowsPerSheet,
            });
        }
        totalCells += Number(sheet.rowCount || 0) * Number(sheet.columnCount || 0);
    }

    if (totalCells > quota.maxTotalCells) {
        throw createGoogleSheetsError('Import size exceeds quota', {
            totalCells,
            maxTotalCells: quota.maxTotalCells,
        });
    }
};

const normalizeSheetSelections = (selections) => {
    if (!Array.isArray(selections) || selections.length === 0) {
        throw createGoogleSheetsError('At least one sheet must be selected');
    }

    return selections.map((item) => ({
        sheetId: item?.sheetId !== undefined && item?.sheetId !== null ? Number(item.sheetId) : null,
        sheetName: item?.sheetName ? String(item.sheetName) : '',
        headerMode: item?.headerMode === 'auto_columns' ? 'auto_columns' : 'first_row',
    }));
};

const prepareGoogleSheetsImport = async ({
    accessToken,
    fileId,
    sheetSelections,
    strictHeader = true,
    quota = DEFAULT_GOOGLE_SHEETS_QUOTA,
}) => {
    const normalizedSelections = normalizeSheetSelections(sheetSelections);
    const spreadsheet = await listSpreadsheetSheets(accessToken, fileId);
    const sheetMapById = new Map();
    const sheetMapByName = new Map();

    for (const sheet of spreadsheet.sheets) {
        sheetMapById.set(Number(sheet.sheetId), sheet);
        sheetMapByName.set(sheet.title, sheet);
    }

    const preparedSheets = [];
    const missingSheets = [];

    for (const selection of normalizedSelections) {
        let sheetInfo = null;
        if (Number.isFinite(selection.sheetId) && sheetMapById.has(Number(selection.sheetId))) {
            sheetInfo = sheetMapById.get(Number(selection.sheetId));
        } else if (selection.sheetName && sheetMapByName.has(selection.sheetName)) {
            sheetInfo = sheetMapByName.get(selection.sheetName);
        }

        if (!sheetInfo) {
            missingSheets.push(selection.sheetId || selection.sheetName || '(unknown)');
            continue;
        }

        const raw = await fetchSheetValuesRaw(accessToken, fileId, sheetInfo.title);
        const prepared = normalizeSheetForImport({
            sheetInfo,
            valuesRows: raw.values,
            headerMode: selection.headerMode,
            strictHeader,
        });
        preparedSheets.push(prepared);
    }

    if (missingSheets.length > 0) {
        throw createGoogleSheetsError('Some selected sheets were not found', { missingSheets });
    }

    validateImportQuotas(preparedSheets, quota);

    const warnings = [];
    preparedSheets.forEach((sheet) => {
        if (sheet.isEmpty) warnings.push(`Sheet "${sheet.sheetName}" is empty`);
        if (sheet.requiresHeaderDecision) warnings.push(`Sheet "${sheet.sheetName}" requires header mode decision`);
    });

    const totalCells = preparedSheets.reduce((acc, sheet) => acc + (sheet.rowCount * sheet.columnCount), 0);

    return {
        spreadsheetId: spreadsheet.spreadsheetId,
        spreadsheetTitle: spreadsheet.title,
        sheets: preparedSheets,
        warnings,
        totalCells,
    };
};

const upsertGoogleSheetTable = async ({
    client,
    connectionId,
    fileId,
    fileName,
    preparedSheet,
}) => {
    const existing = await client.query(
        `SELECT id
         FROM synced_tables
         WHERE connection_id = $1
           AND source_file_id = $2
           AND source_sheet_id = $3
         LIMIT 1`,
        [connectionId, fileId, String(preparedSheet.sheetId)]
    );

    let tableRow;
    if (existing.rows.length > 0) {
        const updated = await client.query(
            `UPDATE synced_tables
             SET table_name = $1,
                 dataset_name = $2,
                 row_count = $3,
                 column_count = $4,
                 status = 'Active',
                 last_sync = NOW(),
                 schema_def = $5::jsonb,
                 ai_definition = CASE
                     WHEN schema_def IS DISTINCT FROM $5::jsonb THEN NULL
                     ELSE ai_definition
                 END,
                 ai_definition_source = CASE
                     WHEN schema_def IS DISTINCT FROM $5::jsonb THEN NULL
                     ELSE ai_definition_source
                 END,
                 ai_definition_provider = CASE
                     WHEN schema_def IS DISTINCT FROM $5::jsonb THEN NULL
                     ELSE ai_definition_provider
                 END,
                 ai_definition_model_id = CASE
                     WHEN schema_def IS DISTINCT FROM $5::jsonb THEN NULL
                     ELSE ai_definition_model_id
                 END,
                 ai_definition_confidence = CASE
                     WHEN schema_def IS DISTINCT FROM $5::jsonb THEN NULL
                     ELSE ai_definition_confidence
                 END,
                 ai_definition_signals = CASE
                     WHEN schema_def IS DISTINCT FROM $5::jsonb THEN '[]'::jsonb
                     ELSE ai_definition_signals
                 END,
                 ai_definition_generated_at = CASE
                     WHEN schema_def IS DISTINCT FROM $5::jsonb THEN NULL
                     ELSE ai_definition_generated_at
                 END,
                 is_deleted = FALSE,
                 source_file_name = $6,
                 source_sheet_name = $7,
                 source_file_id = $8,
                 source_sheet_id = $9,
                 upload_time = NOW()
             WHERE id = $10
             RETURNING *`,
            [
                preparedSheet.sheetName,
                fileId,
                preparedSheet.rowCount,
                preparedSheet.columnCount,
                JSON.stringify(preparedSheet.schema || []),
                fileName,
                preparedSheet.sheetName,
                fileId,
                String(preparedSheet.sheetId),
                existing.rows[0].id,
            ]
        );
        tableRow = updated.rows[0];
    } else {
        const inserted = await client.query(
            `INSERT INTO synced_tables (
                connection_id, table_name, dataset_name,
                row_count, column_count, status,
                last_sync, schema_def, is_deleted,
                source_file_name, upload_time, source_sheet_name,
                source_file_id, source_sheet_id
            )
            VALUES ($1, $2, $3, $4, $5, 'Active', NOW(), $6::jsonb, FALSE, $7, NOW(), $8, $9, $10)
            RETURNING *`,
            [
                connectionId,
                preparedSheet.sheetName,
                fileId,
                preparedSheet.rowCount,
                preparedSheet.columnCount,
                JSON.stringify(preparedSheet.schema || []),
                fileName,
                preparedSheet.sheetName,
                fileId,
                String(preparedSheet.sheetId),
            ]
        );
        tableRow = inserted.rows[0];
    }

    await client.query('DELETE FROM excel_sheet_rows WHERE synced_table_id = $1', [tableRow.id]);

    const rowChunks = chunkArray(preparedSheet.rows || [], 500);
    let rowIndexOffset = 0;
    for (const chunk of rowChunks) {
        const values = [];
        const params = [];
        chunk.forEach((rowData, rowIdx) => {
            const baseIndex = rowIdx * 3;
            values.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}::jsonb)`);
            params.push(
                tableRow.id,
                rowIndexOffset + rowIdx + 1,
                JSON.stringify(rowData || {})
            );
        });

        if (values.length > 0) {
            await client.query(
                `INSERT INTO excel_sheet_rows (synced_table_id, row_index, row_data)
                 VALUES ${values.join(', ')}`,
                params
            );
            rowIndexOffset += chunk.length;
        }
    }

    return tableRow;
};

const importGoogleSheetsToDatabase = async ({
    client,
    connectionId,
    accessToken,
    fileId,
    fileName,
    sheetSelections,
    allowEmptySheets = false,
    strictHeader = true,
    quota = DEFAULT_GOOGLE_SHEETS_QUOTA,
}) => {
    const prepared = await prepareGoogleSheetsImport({
        accessToken,
        fileId,
        sheetSelections,
        strictHeader,
        quota,
    });

    const emptySheets = prepared.sheets.filter((sheet) => sheet.isEmpty).map((sheet) => sheet.sheetName);
    if (!allowEmptySheets && emptySheets.length > 0) {
        throw createGoogleSheetsError('One or more selected sheets are empty', {
            code: 'EMPTY_SHEETS',
            emptySheets,
        });
    }

    const effectiveFileName = fileName || prepared.spreadsheetTitle || fileId;
    const upserted = [];
    for (const sheet of prepared.sheets) {
        const row = await upsertGoogleSheetTable({
            client,
            connectionId,
            fileId,
            fileName: effectiveFileName,
            preparedSheet: sheet,
        });
        upserted.push(row);
    }

    await client.query(
        `UPDATE connections
         SET table_count = (
            SELECT COUNT(*) FROM synced_tables WHERE connection_id = $1 AND is_deleted = FALSE
         )
         WHERE id = $1`,
        [connectionId]
    );

    return {
        sheets: prepared.sheets,
        warnings: prepared.warnings,
        tables: upserted,
        fileName: effectiveFileName,
    };
};

const preflightGoogleSheetsImport = async ({
    accessToken,
    fileId,
    sheetSelections,
    quota = DEFAULT_GOOGLE_SHEETS_QUOTA,
}) => {
    const prepared = await prepareGoogleSheetsImport({
        accessToken,
        fileId,
        sheetSelections,
        strictHeader: false,
        quota,
    });

    return {
        spreadsheetId: prepared.spreadsheetId,
        spreadsheetTitle: prepared.spreadsheetTitle,
        totalCells: prepared.totalCells,
        quota,
        sheets: prepared.sheets.map((sheet) => ({
            sheetId: sheet.sheetId,
            sheetName: sheet.sheetName,
            rowCount: sheet.rowCount,
            columnCount: sheet.columnCount,
            isEmpty: sheet.isEmpty,
            hasValidHeader: sheet.hasValidHeader,
            requiresHeaderDecision: sheet.requiresHeaderDecision,
            sampleHeader: sheet.sampleHeader,
            suggestedHeaderMode: sheet.hasValidHeader ? 'first_row' : 'auto_columns',
        })),
        warnings: prepared.warnings,
    };
};

const findExistingGoogleSheetTables = async ({ client, connectionId, fileId, sheetSelections }) => {
    const selections = normalizeSheetSelections(sheetSelections);
    const sheetIds = selections
        .map((s) => (Number.isFinite(s.sheetId) ? String(Number(s.sheetId)) : null))
        .filter(Boolean);
    if (sheetIds.length === 0) return [];

    const result = await client.query(
        `SELECT id, table_name, source_sheet_name, source_sheet_id
         FROM synced_tables
         WHERE connection_id = $1
           AND source_file_id = $2
           AND source_sheet_id = ANY($3::text[])
           AND is_deleted = FALSE`,
        [connectionId, fileId, sheetIds]
    );

    return result.rows || [];
};

module.exports = {
    DEFAULT_GOOGLE_SHEETS_QUOTA,
    GOOGLE_SHEETS_MIME_TYPE,
    createGoogleSheetsError,
    parseSpreadsheetIdFromUrl,
    listSpreadsheetFiles,
    resolveSpreadsheetUrl,
    listSpreadsheetSheets,
    getSpreadsheetFileMetadata,
    preflightGoogleSheetsImport,
    importGoogleSheetsToDatabase,
    findExistingGoogleSheetTables,
};
