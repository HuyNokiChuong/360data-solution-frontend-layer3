
import { normalizeAggregation } from '../utils/aggregation';

interface Project {
    id: string;
    name: string;
}

interface Dataset {
    id: string;
    name: string;
}

interface Table {
    id: string;
    name: string;
    rows: number;
    dataset: string;
    schema: { name: string, type: string }[];
}

let tokenRefreshPromise: Promise<string | null> | null = null;

const setBearerToken = (headers: HeadersInit | undefined, token: string): Headers => {
    const next = new Headers(headers || {});
    next.set('Authorization', `Bearer ${token}`);
    return next;
};

const getBearerToken = (headers: HeadersInit | undefined): string | null => {
    const auth = new Headers(headers || {}).get('Authorization');
    if (!auth) return null;
    const [scheme, value] = auth.split(' ');
    if (!scheme || !value) return null;
    if (scheme.toLowerCase() !== 'bearer') return null;
    return value;
};

const getClientId = (): string => {
    // Keep consistent with other modules: deployments may set only VITE_GOOGLE_CLIENT_ID.
    const env = import.meta.env as any;
    const envClientId = env.VITE_GOOGLE_OAUTH_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
    return String(envClientId).trim();
};

const getLatestStoredToken = async (): Promise<string | null> => {
    if (typeof window === 'undefined') return null;
    try {
        const { getStoredToken } = await import('./googleAuth');
        return getStoredToken();
    } catch {
        return null;
    }
};

const refreshGoogleTokenOnce = async (): Promise<string | null> => {
    if (typeof window === 'undefined') return null;
    const clientId = getClientId();
    if (!clientId) return null;

    if (!tokenRefreshPromise) {
        tokenRefreshPromise = (async () => {
            try {
                const { getValidToken } = await import('./googleAuth');
                return await getValidToken(clientId);
            } catch {
                return null;
            } finally {
                tokenRefreshPromise = null;
            }
        })();
    }

    return tokenRefreshPromise;
};

const fetchWithTokenRefresh = async (
    url: string,
    init: RequestInit,
    fallbackToken: string
): Promise<{ response: Response; token: string }> => {
    let activeToken = fallbackToken;

    let response = await fetch(url, {
        ...init,
        headers: setBearerToken(init.headers, activeToken),
    });

    if (response.status !== 401) {
        return { response, token: activeToken };
    }

    const storedToken = await getLatestStoredToken();
    const canUseGoogleRefresh = !storedToken || storedToken === activeToken;
    if (!canUseGoogleRefresh) {
        return { response, token: activeToken };
    }

    const refreshed = await refreshGoogleTokenOnce();
    if (!refreshed || refreshed === activeToken) {
        return { response, token: activeToken };
    }

    response = await fetch(url, {
        ...init,
        headers: setBearerToken(init.headers, refreshed),
    });

    return { response, token: refreshed };
};

export const fetchProjects = async (token: string): Promise<Project[]> => {
    let projects: Project[] = [];
    let pageToken: string | undefined;
    let activeToken = token;

    try {
        do {
            const url = new URL('https://bigquery.googleapis.com/bigquery/v2/projects');
            url.searchParams.append('maxResults', '1000');
            if (pageToken) url.searchParams.append('pageToken', pageToken);

            const { response, token: nextToken } = await fetchWithTokenRefresh(url.toString(), {
                headers: {},
            }, activeToken);
            activeToken = nextToken;
            if (!response.ok) throw new Error('Failed to fetch projects');
            const data = await response.json();

            const items = (data.projects || []).map((p: any) => ({
                id: p.projectReference.projectId,
                name: p.friendlyName || p.id,
            }));

            projects = [...projects, ...items];
            pageToken = data.nextPageToken;
        } while (pageToken);

        return projects;
    } catch (error) {
        // console.error(error);
        return projects;
    }
};

export const fetchDatasets = async (token: string, projectId: string): Promise<Dataset[]> => {
    let datasets: Dataset[] = [];
    let pageToken: string | undefined;
    let activeToken = token;

    try {
        do {
            const url = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets`);
            url.searchParams.append('maxResults', '1000');
            if (pageToken) url.searchParams.append('pageToken', pageToken);

            const { response, token: nextToken } = await fetchWithTokenRefresh(url.toString(), {
                headers: {},
            }, activeToken);
            activeToken = nextToken;
            if (!response.ok) throw new Error('Failed to fetch datasets');
            const data = await response.json();

            const items = (data.datasets || []).map((d: any) => ({
                id: d.datasetReference.datasetId,
                name: d.datasetReference.datasetId,
            }));

            datasets = [...datasets, ...items];
            pageToken = data.nextPageToken;
        } while (pageToken);

        return datasets;
    } catch (error) {
        // console.error(error);
        return datasets;
    }
};

export const fetchTables = async (token: string, projectId: string, datasetId: string): Promise<Table[]> => {
    let tables: Table[] = [];
    let pageToken: string | undefined;
    let activeToken = token;

    try {
        // 1. Fetch tables list (to get IDs and pagination)
        do {
            const url = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`);
            url.searchParams.append('maxResults', '1000');
            if (pageToken) url.searchParams.append('pageToken', pageToken);

            const { response, token: nextToken } = await fetchWithTokenRefresh(url.toString(), {
                headers: {},
            }, activeToken);
            activeToken = nextToken;
            if (!response.ok) throw new Error('Failed to fetch tables');
            const data = await response.json();

            const items = (data.tables || []).map((t: any) => ({
                id: t.tableReference.tableId,
                name: t.tableReference.tableId,
                rows: 0,
                dataset: datasetId,
                schema: []
            }));

            tables = [...tables, ...items];
            pageToken = data.nextPageToken;
        } while (pageToken);

        // 2. Fetch row counts using __TABLES__ meta-table
        try {
            const query = `SELECT table_id, row_count FROM \`${projectId}.${datasetId}.__TABLES__\``;
            const { response: queryResponse, token: nextToken } = await fetchWithTokenRefresh(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, useLegacySql: false }),
            }, activeToken);
            activeToken = nextToken;

            if (queryResponse.ok) {
                const queryData = await queryResponse.json();
                const countMap: Record<string, number> = {};
                (queryData.rows || []).forEach((row: any) => {
                    const tid = row.f[0].v;
                    const count = parseInt(row.f[1].v);
                    countMap[tid] = count;
                });

                tables = tables.map(t => ({
                    ...t,
                    rows: countMap[t.id] || 0
                }));
            }
        } catch (e) {
            // console.warn("Failed to fetch row counts via query", e);
        }

        // 3. Fetch schemas using INFORMATION_SCHEMA.COLUMNS
        try {
            const schemaQuery = `SELECT table_name, column_name, data_type FROM \`${projectId}.${datasetId}.INFORMATION_SCHEMA.COLUMNS\` ORDER BY table_name, ordinal_position`;
            const { response: schemaResponse, token: nextToken } = await fetchWithTokenRefresh(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: schemaQuery, useLegacySql: false }),
            }, activeToken);
            activeToken = nextToken;

            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                const schemaMap: Record<string, { name: string, type: string }[]> = {};
                (schemaData.rows || []).forEach((row: any) => {
                    const tname = row.f[0].v;
                    const cname = row.f[1].v;
                    const dtype = row.f[2].v;
                    if (!schemaMap[tname]) schemaMap[tname] = [];
                    schemaMap[tname].push({ name: cname, type: dtype });
                });

                tables = tables.map(t => ({
                    ...t,
                    schema: schemaMap[t.name] || []
                }));
            }
        } catch (e) {
            // console.warn("Failed to fetch schemas via query", e);
        }

        return tables;
    } catch (error) {
        // console.error(error);
        return tables;
    }
}

const fetchWithRetry = async (url: string, options: any, retries = 3, backoff = 1000): Promise<Response> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
        // Enforce a 30s timeout if not present in options
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 30000);

        // If options.signal exists, we strictly should respect it, but we also want a timeout.
        // Merging signals is complex, so we'll just use the timeout if no signal, 
        // or rely on the caller's signal. 
        // Ideally: use a wrapper to race the caller signal and our timeout.
        // For simplicity: We will rely on the fetch call's timeout pattern.

        const finalOptions = { ...options };
        if (!finalOptions.signal) {
            finalOptions.signal = controller.signal;
        }

        let response: Response;
        const bearerToken = getBearerToken(finalOptions.headers);
        if (bearerToken) {
            const authResult = await fetchWithTokenRefresh(url, finalOptions, bearerToken);
            response = authResult.response;
            finalOptions.headers = setBearerToken(finalOptions.headers, authResult.token);
        } else {
            response = await fetch(url, finalOptions);
        }

        if (response.ok) return response;

        // Only retry on transient errors (5xx) or rate limits (429)
        if (retries > 0 && (response.status >= 500 || response.status === 429)) {
            // console.warn(`⏳ Request failed (${response.status}). Retrying in ${backoff}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        return response;
    } catch (error: any) {
        if (error.name === 'AbortError') throw error; // Don't retry aborts

        if (retries > 0) {
            // console.warn(`⏳ Network error. Retrying in ${backoff}ms...`, error);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
};

export const fetchTableData = async (
    token: string,
    projectId: string,
    datasetId: string,
    tableId: string,
    options?: {
        limit?: number;
        onPartialResults?: (rows: any[], totalRows: number) => void;
        signal?: AbortSignal;
    }
): Promise<{ rows: any[], schema: { name: string, type: string }[] }> => {
    try {
        const { limit, onPartialResults, signal } = options || {};
        let activeToken = token;
        // console.log('🔍 fetchTableData: Starting fetch for', { projectId, datasetId, tableId, limit });

        const query = `SELECT * FROM \`${projectId}.${datasetId}.${tableId}\`${limit ? ` LIMIT ${limit}` : ''}`;

        // 1. Start the Query - Request a smaller initial batch for instant UI feedback
        const INITIAL_BATCH_SIZE = 50000;
        const firstQuery = await fetchWithTokenRefresh(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
                useLegacySql: false,
                timeoutMs: 30000,
                maxResults: limit ? Math.min(limit, INITIAL_BATCH_SIZE) : INITIAL_BATCH_SIZE
            }),
            signal
        }, activeToken);
        let response = firstQuery.response;
        activeToken = firstQuery.token;

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 401) {
                throw new Error('UNAUTHORIZED');
            }
            throw new Error(`BigQuery Query Error: ${errorData.error?.message || response.statusText}`);
        }

        let data = await response.json();
        let jobId = data.jobReference?.jobId;
        let location = data.jobReference?.location;
        let schema_fields = data.schema?.fields;

        // 2. Poll if job not complete
        let waitTime = 1000;
        while (!data.jobComplete) {
            // console.log(`⏳ Job ${jobId} not complete. Waiting ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));

            const pollUrl = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`);
            pollUrl.searchParams.append('maxResults', (limit ? Math.min(limit, INITIAL_BATCH_SIZE) : INITIAL_BATCH_SIZE).toString());
            if (location) pollUrl.searchParams.append('location', location);

            const pollResult = await fetchWithTokenRefresh(pollUrl.toString(), {
                headers: {},
                signal
            }, activeToken);
            const pollResp = pollResult.response;
            activeToken = pollResult.token;

            if (!pollResp.ok) {
                const err = await pollResp.json().catch(() => ({}));
                // console.error("❌ Polling failed:", err);
                break;
            }

            data = await pollResp.json();
            if (data.schema?.fields) schema_fields = data.schema.fields;
            waitTime = Math.min(waitTime * 1.5, 5000); // Exponential backoff
        }

        if (!data.jobComplete) throw new Error("BigQuery job failed to complete in time.");

        // 3. Hyper-Fast Row Parsing with Pre-calculated Mappers
        const fields = schema_fields || [];
        const schema = fields.map((f: any) => ({ name: f.name, type: f.type }));
        const totalRows = parseInt(data.totalRows || '0');

        // PRE-CALCULATE MAPPERS: Avoid string checks inside the hot loop
        const fieldMappers = fields.map((field: any) => {
            const name = field.name.trim();
            const type = field.type;
            const isNumeric = ['INTEGER', 'FLOAT', 'FLOAT64', 'INT64', 'NUMERIC', 'BIGNUMERIC'].includes(type);

            if (isNumeric) {
                return (rowData: any, val: any) => {
                    if (val !== null && val !== undefined && val !== '') {
                        const num = parseFloat(val);
                        rowData[name] = isNaN(num) ? null : num;
                    } else {
                        rowData[name] = null;
                    }
                };
            }
            return (rowData: any, val: any) => {
                rowData[name] = val;
            };
        });

        const parseRowsAsync = async (bigQueryRows: any[]) => {
            if (!bigQueryRows || bigQueryRows.length === 0) return [];

            const parsed: any[] = [];
            const CHUNK_SIZE = 5000; // Reduced from 25k to keep event loop responsive and memory low


            for (let i = 0; i < bigQueryRows.length; i += CHUNK_SIZE) {
                const chunk = bigQueryRows.slice(i, i + CHUNK_SIZE);
                const results = new Array(chunk.length);

                for (let j = 0; j < chunk.length; j++) {
                    const rowJson = chunk[j];
                    const rowData: any = {};
                    if (rowJson?.f) {
                        for (let k = 0; k < fieldMappers.length; k++) {
                            // Direct call is faster than check?
                            fieldMappers[k](rowData, rowJson.f[k]?.v);
                        }
                    }
                    results[j] = rowData;
                }
                parsed.push(...results);

                if (bigQueryRows.length > CHUNK_SIZE) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            return parsed;
        };

        // 4. Initial results
        let currentRows = data.rows || [];
        let pageToken = data.pageToken;

        // FIX: If first response is empty but data exists elsewhere, fetch it
        if (currentRows.length === 0 && totalRows > 0 && pageToken) {
            // console.log("🔄 Initial rows empty but data exists. Fetching first page via pageToken...");
            const nextUrl = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`);
            nextUrl.searchParams.append('pageToken', pageToken);
            nextUrl.searchParams.append('maxResults', (limit ? Math.min(limit, INITIAL_BATCH_SIZE) : INITIAL_BATCH_SIZE).toString());
            if (location) nextUrl.searchParams.append('location', location);

            const nextResult = await fetchWithTokenRefresh(nextUrl.toString(), {
                headers: {},
                signal
            }, activeToken);
            const nextResp = nextResult.response;
            activeToken = nextResult.token;

            if (nextResp.ok) {
                const nextData = await nextResp.json();
                currentRows = nextData.rows || [];
                pageToken = nextData.pageToken;
            }
        }

        let parsedRows = await parseRowsAsync(currentRows);
        const allRows = [...parsedRows];

        if (onPartialResults) {
            onPartialResults(parsedRows, totalRows);
        }

        // 5. High-Speed Parallel Fetching for Subsequent Pages
        let totalItemsFetched = currentRows.length;
        const PARALLEL_CHUNK_SIZE = 15000; // Reduced from 50k to prevent OOM
        // Maximize concurrency to a safe limit (3 to prevent browser OOM)
        const CONCURRENCY = 3;

        if (totalRows > totalItemsFetched && (!limit || totalItemsFetched < limit)) {
            const startOffset = totalItemsFetched;
            const endOffset = limit ? Math.min(totalRows, limit) : totalRows;
            const totalToFetch = endOffset - startOffset;

            const chunkStarts: number[] = [];
            for (let i = startOffset; i < endOffset; i += PARALLEL_CHUNK_SIZE) {
                chunkStarts.push(i);
            }

            // console.log(`🚀 Slicing ${totalToFetch} rows into ${chunkStarts.length} parallel batches (Concurrency: ${CONCURRENCY})...`);

            let firstError: Error | null = null; // Track first error to stop all workers

            const fetchChunk = async (startIndex: number) => {
                const targetChunkSize = Math.min(PARALLEL_CHUNK_SIZE, endOffset - startIndex);
                if (targetChunkSize <= 0) return;

                let fetchedCount = 0;
                let currentStartIndex = startIndex;

                // Keep fetching until we fill the chunk or run out of data
                while (fetchedCount < targetChunkSize && !firstError) {
                    const remaining = targetChunkSize - fetchedCount;
                    const maxResults = remaining;

                    const chunkUrl = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`);
                    chunkUrl.searchParams.append('startIndex', currentStartIndex.toString());
                    chunkUrl.searchParams.append('maxResults', maxResults.toString());
                    if (location) chunkUrl.searchParams.append('location', location);

                    try {
                        const resp = await fetchWithRetry(chunkUrl.toString(), {
                            headers: { Authorization: `Bearer ${activeToken}` },
                            signal
                        });

                        if (!resp.ok) {
                            const err = await resp.json().catch(() => ({}));
                            throw new Error(`Chunk ${currentStartIndex} failed: ${err.error?.message || resp.statusText}`);
                        }

                        const chunkData = await resp.json();
                        const rows = chunkData.rows || [];
                        const rowCount = rows.length;

                        if (rowCount > 0) {
                            // Optimized parsing without heavy yielding for sub-chunks
                            const parsed = await parseRowsAsync(rows);
                            allRows.push(...parsed);
                            if (onPartialResults) {
                                onPartialResults(parsed, totalRows);
                            }
                            fetchedCount += rowCount;
                            currentStartIndex += rowCount;
                        } else {
                            // If we expected more data but got 0 rows, this is an error
                            if (fetchedCount < targetChunkSize && !limit) {
                                const error = new Error(`Data incomplete: Batch at ${currentStartIndex} returned 0 rows but expected ${remaining} more rows.`);
                                if (!firstError) {
                                    firstError = error;
                                    pool.length = 0; // Clear pool to stop other workers
                                }
                                throw error;
                            }
                            break;
                        }
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        if (!firstError) {
                            firstError = err;
                            pool.length = 0; // Clear pool to stop other workers
                        }
                        throw err;
                    }
                }
            };

            const pool = [...chunkStarts];
            const workers = Array(CONCURRENCY).fill(null).map(async () => {
                while (pool.length > 0 && !firstError) {
                    const start = pool.shift();
                    if (start !== undefined) {
                        try {
                            await fetchChunk(start);
                        } catch (error) {
                            // Error already tracked in firstError, just stop this worker
                            break;
                        }
                    }
                }
            });

            await Promise.all(workers);

            // If any error occurred, throw it to prevent partial data load
            if (firstError) {
                throw firstError;
            }
            // console.log(`✅ All workers finished for ${tableId}.`);
        }

        // console.log(`✅ Parallel Data Sync Complete.`);
        return { rows: allRows, schema };
    } catch (error: any) {
        if (error.name === 'AbortError') {
            // console.log('⏹️ fetchTableData aborted.');
            throw error;
        }
        // console.error('❌ fetchTableData CRITICAL error:', error);
        if (error instanceof Error) {
            // console.error('Error message:', error.message);
            // console.error('Error stack:', error.stack);
        }
        throw error;
    }
};


export const fetchTableSchema = async (
    token: string,
    projectId: string,
    datasetId: string,
    tableId: string,
    signal?: AbortSignal
): Promise<{ name: string, type: string }[]> => {
    try {
        const query = `SELECT column_name, data_type FROM \`${projectId}.${datasetId}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = '${tableId}' ORDER BY ordinal_position`;
        const result = await fetchWithTokenRefresh(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, useLegacySql: false }),
            signal
        }, token);
        const response = result.response;

        if (!response.ok) throw new Error('Failed to fetch schema');
        const data = await response.json();
        return (data.rows || []).map((row: any) => ({
            name: row.f[0].v,
            type: row.f[1].v
        }));
    } catch (error) {
        if ((error as any)?.name === 'AbortError') {
            throw error;
        }
        // console.error('Failed to fetch schema:', error);
        return [];
    }
};

/**
 * Fetch aggregated data directly from BigQuery.
 * This is the primary optimization for "Big Data" where we don't want to load all rows.
 */
export const fetchAggregatedData = async (
    token: string,
    projectId: string,
    datasetId: string,
    tableId: string,
    options: {
        dimensions: (string | { field: string; expression?: string })[];
        measures: { field: string; aggregation: string; expression?: string }[];
        filters?: any[];
        limit?: number;
        signal?: AbortSignal;
        sortBy?: string | string[];
        sortDir?: 'ASC' | 'DESC';
        groupByIndices?: boolean; // Whether to use numeric indices in GROUP BY (e.g. GROUP BY 1, 2)
    }
): Promise<any[]> => {
    const { dimensions, measures, filters, limit, signal, sortBy, sortDir, groupByIndices = true } = options;

    // Helper to format a field reference (handles Table.Column -> `Table`.`Column`)
    const formatColumnReference = (col: string) => {
        if (col.includes('.')) {
            const parts = col.split('.');
            return parts.map(p => `\`${p}\``).join('.');
        }
        return `\`${col}\``;
    };

    // Helper to handle date extraction parts (e.g., "date_field.___year")
    const parseField = (f: string) => {
        if (f.includes('___')) {
            const [field, part] = f.split('___');
            const colRef = formatColumnReference(field);

            switch (part) {
                case 'year': return `EXTRACT(YEAR FROM ${colRef})`;
                case 'month': return `EXTRACT(MONTH FROM ${colRef})`;
                case 'day': return `EXTRACT(DAY FROM ${colRef})`;
                case 'quarter': return `EXTRACT(QUARTER FROM ${colRef})`;
                case 'half': return `CASE WHEN ${colRef} IS NULL THEN NULL WHEN EXTRACT(MONTH FROM ${colRef}) <= 6 THEN 1 ELSE 2 END`;
                case 'hour': return `EXTRACT(HOUR FROM ${colRef})`;
                case 'minute': return `EXTRACT(MINUTE FROM ${colRef})`;
                case 'second': return `EXTRACT(SECOND FROM ${colRef})`;
                default: return colRef;
            }
        }
        return formatColumnReference(f);
    };

    // 1. Build SELECT clause
    const selectParts = [
        ...dimensions.map(d => {
            const fieldName = typeof d === 'string' ? d : d.field;
            const expression = typeof d === 'string' ? parseField(d) : (d.expression || parseField(d.field));
            return `${expression} as \`${fieldName}\``;
        }),
        ...measures.map(m => {
            const normalizedAgg = normalizeAggregation(m.aggregation);
            const agg = normalizedAgg.toUpperCase();
            // Use m.expression if provided
            const colRef = m.expression ? m.expression : formatColumnReference(m.field);
            let sqlAgg = '';

            switch (agg) {
                case 'COUNTDISTINCT': sqlAgg = `COUNT(DISTINCT ${colRef})`; break;
                case 'AVG': sqlAgg = `AVG(${colRef})`; break;
                case 'SUM': sqlAgg = `SUM(${colRef})`; break;
                case 'MIN': sqlAgg = `MIN(${colRef})`; break;
                case 'MAX': sqlAgg = `MAX(${colRef})`; break;
                case 'COUNT': sqlAgg = `COUNT(${colRef})`; break;
                case 'NONE': case 'RAW': sqlAgg = colRef; break;
                default: sqlAgg = colRef; // Fallback
            }
            return `${sqlAgg} as \`${m.field}_${normalizedAgg}\``;
        })
    ];

    if (selectParts.length === 0) return [];

    // 2. Build WHERE clause
    let whereClause = '';
    if (filters && filters.length > 0) {
        const filterParts = filters.map(f => {
            if (!f.field || f.enabled === false) return null;

            // Use f.expression if provided (for calculated fields in WHERE)
            const field = f.expression ? f.expression : parseField(f.field);
            const operator = f.operator;
            const val = f.value;

            // Format value for SQL
            const formatVal = (v: any) => {
                if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
                if (v instanceof Date) return `'${v.toISOString()}'`;
                return v;
            };

            const isRangeOrComp = ['between', 'greaterThan', 'lessThan', 'greaterOrEqual', 'lessOrEqual'].includes(operator);
            const notNullSuffix = isRangeOrComp ? ` AND ${field} IS NOT NULL` : '';

            switch (operator) {
                case 'equals':
                    if (val === null || val === undefined || val === '(Blank)') return `${field} IS NULL`;
                    return `${field} = ${formatVal(val)}`;
                case 'notEquals':
                    if (val === null || val === undefined || val === '(Blank)') return `${field} IS NOT NULL`;
                    return `${field} != ${formatVal(val)}`;
                case 'contains': return `${field} LIKE '%${val}%'`;
                case 'notContains': return `${field} NOT LIKE '%${val}%'`;
                case 'startsWith': return `${field} LIKE '${val}%'`;
                case 'endsWith': return `${field} LIKE '%${val}'`;
                case 'greaterThan': return `(${field} > ${formatVal(val)}${notNullSuffix})`;
                case 'lessThan': return `(${field} < ${formatVal(val)}${notNullSuffix})`;
                case 'greaterOrEqual': return `(${field} >= ${formatVal(val)}${notNullSuffix})`;
                case 'lessOrEqual': return `(${field} <= ${formatVal(val)}${notNullSuffix})`;
                case 'between': return `(${field} BETWEEN ${formatVal(val)} AND ${formatVal(f.value2)}${notNullSuffix})`;
                case 'in': return `${field} IN (${Array.isArray(val) ? val.map(formatVal).join(', ') : formatVal(val)})`;
                case 'notIn': return `${field} NOT IN (${Array.isArray(val) ? val.map(formatVal).join(', ') : formatVal(val)})`;
                case 'isNull': return `${field} IS NULL`;
                case 'isNotNull': return `${field} IS NOT NULL`;
                default: return null;
            }
        }).filter(Boolean);

        if (filterParts.length > 0) {
            whereClause = ` WHERE ${filterParts.join(' AND ')}`;
        }
    }

    // 3. Build GROUP BY clause
    // If no measures, we use SELECT DISTINCT to get unique dimension combinations
    // If has measures, we must GROUP BY dimensions
    const hasMeasures = measures.some(m => normalizeAggregation(m.aggregation) !== 'none');
    let groupByClause = '';
    let distinctClause = '';

    if (dimensions.length > 0) {
        if (hasMeasures) {
            groupByClause = groupByIndices
                ? ` GROUP BY ${dimensions.map((_, i) => i + 1).join(', ')}`
                : ` GROUP BY ${dimensions.map(d => {
                    if (typeof d === 'string') return parseField(d);
                    return d.expression || parseField(d.field);
                }).join(', ')}`;
        } else {
            distinctClause = 'DISTINCT ';
        }
    }

    // 4. Build ORDER BY clause
    let orderByClause = '';
    if (sortBy) {
        const sortByArray = Array.isArray(sortBy) ? sortBy : [sortBy];
        orderByClause = ` ORDER BY ${sortByArray.map(s => `\`${s}\` ${sortDir || 'ASC'}`).join(', ')}`;
    } else if (dimensions.length > 0) {
        // Default sort by ALL dimensions to ensure hierarchy and time series order
        const sortParts = dimensions.map((_, i) => `${i + 1} ASC`);
        orderByClause = ` ORDER BY ${sortParts.join(', ')}`;
    }

    // 5. Build Final Query
    const query = `SELECT ${distinctClause}${selectParts.join(', ')} FROM \`${projectId}.${datasetId}.${tableId}\`${whereClause}${groupByClause}${orderByClause}${limit ? ` LIMIT ${limit}` : ''}`;

    // console.log('🚀 Remote Aggregation Query:', query);

    const results = await runQuery(token, projectId, query, signal);
    return results;
};

export const runQuery = async (token: string, projectId: string, query: string, signal?: AbortSignal): Promise<any[]> => {
    try {
        let activeToken = token;
        const firstQuery = await fetchWithTokenRefresh(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, useLegacySql: false, timeoutMs: 30000, maxResults: 1000000 }),
            signal
        }, activeToken);
        const response = firstQuery.response;
        activeToken = firstQuery.token;

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'Failed to execute query');
        }

        let data = await response.json();
        if (!data.jobComplete) {
            const jobId = data.jobReference.jobId;
            const location = data.jobReference.location;
            let waitTime = 1000;
            while (!data.jobComplete) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
                const pollResult = await fetchWithTokenRefresh(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}${location ? `?location=${location}` : ''}`, {
                    headers: {},
                    signal
                }, activeToken);
                activeToken = pollResult.token;
                data = await pollResult.response.json();
                waitTime = Math.min(waitTime * 1.5, 5000);
            }
        }
        return parseBigQueryResponse(data);
    } catch (error) {
        // console.error("Query Execution Error:", error);
        throw error;
    }
};

export const parseBigQueryResponse = (data: any): any[] => {
    if (!data.rows || !data.schema || !data.schema.fields) return [];
    const fields = data.schema.fields;
    return data.rows.map((row: any) => {
        const rowData: any = {};
        if (row?.f) {
            row.f.forEach((cell: any, i: number) => {
                const field = fields[i];
                let val = cell.v;
                if (['INTEGER', 'FLOAT', 'FLOAT64', 'INT64', 'NUMERIC'].includes(field.type)) {
                    val = val !== null && val !== undefined ? parseFloat(val) : null;
                }
                rowData[field.name] = val;
            });
        }
        return rowData;
    });
};


// Utility to Clear a GCS Folder (recursively by prefix)
export const clearGCSFolder = async (
    token: string,
    bucketName: string,
    prefix: string,
    signal?: AbortSignal
): Promise<void> => {
    // console.log(`🧹 Clearing GCS folder: gs://${bucketName}/${prefix}`);

    let pageToken: string | undefined;
    do {
        const listUrl = new URL(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o`);
        listUrl.searchParams.append('prefix', prefix);
        if (pageToken) listUrl.searchParams.append('pageToken', pageToken);

        const listResp = await fetchWithRetry(listUrl.toString(), {
            headers: { Authorization: `Bearer ${token}` },
            signal
        });

        if (!listResp.ok) throw new Error('Failed to list GCS files for cleanup');
        const listData = await listResp.json();
        const items = listData.items || [];

        if (items.length > 0) {
            const deletePromises = items.map((item: any) =>
                fetch(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(item.name)}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                    signal
                }).catch(e => console.warn(`Failed to delete`, e))
            );
            await Promise.all(deletePromises);
            // console.log(`Deleted ${items.length} files from ${prefix}`);
        }

        pageToken = listData.nextPageToken;
    } while (pageToken);
};

// Utility to write a file to GCS (e.g., for logs)
export const writeGCSFile = async (
    token: string,
    bucketName: string,
    fileName: string,
    content: string,
    contentType: string = 'text/plain',
    signal?: AbortSignal
): Promise<void> => {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${encodeURIComponent(fileName)}`;

    await fetchWithRetry(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': contentType
        },
        body: content,
        signal
    });
};

export const exportTableToGCS = async (
    token: string,
    projectId: string,
    datasetId: string,
    tableId: string,
    bucketName: string,
    options?: { signal?: AbortSignal }
): Promise<string[]> => {
    const { signal } = options || {};

    // User Request: Folder name same as table name
    const folderPrefix = `${tableId}/`;
    const destinationUri = `gs://${bucketName}/${folderPrefix}export-*.json`;

    // console.log(`🚀 Starting BigQuery Export Job: ${tableId} -> ${destinationUri}`);

    // 1. Create Extract Job
    const jobUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs`;
    const response = await fetch(jobUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            configuration: {
                extract: {
                    sourceTable: { projectId, datasetId, tableId },
                    destinationUris: [destinationUri],
                    destinationFormat: 'NEWLINE_DELIMITED_JSON'
                }
            }
        }),
        signal
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(`Failed to create export job: ${err.error?.message || response.statusText}`);
    }

    const jobData = await response.json();
    const jobId = jobData.jobReference.jobId;
    const location = jobData.jobReference.location;

    // 2. Poll Job Status
    let waitTime = 1000;
    let complete = false;
    let finalJobData = jobData;

    while (!complete) {
        if (signal?.aborted) throw new Error('Aborted');

        // console.log(`⏳ Waiting for export job ${jobId}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));

        const checkUrl = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs/${jobId}`);
        if (location) checkUrl.searchParams.append('location', location);

        const checkResp = await fetchWithRetry(checkUrl.toString(), {
            headers: { Authorization: `Bearer ${token}` },
            signal
        });

        finalJobData = await checkResp.json();
        if (finalJobData.status?.state === 'DONE') {
            complete = true;
            if (finalJobData.status?.errorResult) {
                throw new Error(`Export job failed: ${finalJobData.status.errorResult.message}`);
            }
        }

        waitTime = Math.min(waitTime * 1.5, 5000);
    }

    // console.log('✅ Export Job Complete via API.');

    // 3. List the exported files
    const listUrl = new URL(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o`);
    listUrl.searchParams.append('prefix', folderPrefix);

    const listResp = await fetchWithRetry(listUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal
    });

    if (!listResp.ok) throw new Error('Failed to list exported files from GCS');
    const listData = await listResp.json();

    // Clean up urls? No, we just need names to download
    return (listData.items || []).map((item: any) => item.name);
};

export const downloadGCSFile = async (
    token: string,
    bucketName: string,
    fileName: string,
    signal?: AbortSignal
): Promise<any[]> => {
    // Media download link
    const url = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(fileName)}?alt=media`;

    // Using fetchWithRetry but note: GCS might need explicit CORS for the origin
    const response = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal
    });

    if (!response.ok) throw new Error(`Failed to download ${fileName}`);

    // STREAMING PARSE to avoid OOM on large files
    if (response.body) {
        return parseJSONLStream(response.body);
    } else {
        const text = await response.text();
        return parseJSONL(text);
    }
};

// Streaming JSONL Parser using Web Streams API
const parseJSONLStream = async (stream: ReadableStream<Uint8Array>): Promise<any[]> => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const result: any[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                try {
                    result.push(JSON.parse(line));
                } catch (e) { }
            }
        }

        // Yield to maintain UI responsiveness
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (buffer.trim()) {
        try {
            result.push(JSON.parse(buffer));
        } catch (e) { }
    }

    return result;
};

// Faster JSONL Parser
export const parseJSONL = (text: string): any[] => {
    const lines = text.split('\n');
    const result = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
            try {
                result.push(JSON.parse(line));
            } catch (e) {
                // Ignore bad lines or empty
            }
        }
    }
    return result;
};

// Optimized Data Fetch Orchestrator via GCS
export const fetchTableDataViaExport = async (
    token: string,
    projectId: string,
    datasetId: string,
    tableId: string,
    bucketName: string,
    options?: {
        onPartialResults?: (rows: any[], totalRows: number) => void;
        signal?: AbortSignal;
    }
) => {
    const { onPartialResults, signal } = options || {};

    // 0. CLEAR GCS Folder First
    await clearGCSFolder(token, bucketName, `${tableId}/`, signal);

    // 1. Export
    const fileNames = await exportTableToGCS(token, projectId, datasetId, tableId, bucketName, { signal });

    if (fileNames.length === 0) return { rows: [], schema: [] }; // No data

    // console.log(`📦 Found ${fileNames.length} shards on GCS. Downloading in parallel...`);

    // 2. Download in Parallel (Safe concurrency for browser)
    const CONCURRENCY = 3;
    let totalLoaded = 0;
    let firstError: Error | null = null; // Track first error to throw after all workers stop

    const logHistory = async (msg: string) => {
        const timestamp = new Date().toISOString();
        const content = `[${timestamp}] ${msg}\n`;
        // Append to GCS log file
        try {
            // We'll just write the latest message for now to avoid reading/writing huge log files
            // In a better version, we'd append.
            await writeGCSFile(token, bucketName, `${tableId}/_fetch_progress.log`, content);
        } catch (e) { }
    };

    const queue = [...fileNames];
    const workers = Array(CONCURRENCY).fill(null).map(async () => {
        while (queue.length > 0 && !firstError) { // Stop if error occurred
            const fileName = queue.shift();
            if (!fileName || signal?.aborted) break;

            try {
                const rows = await downloadGCSFile(token, bucketName, fileName, signal);
                totalLoaded += rows.length;

                await logHistory(`Downloaded ${fileName}: +${rows.length} rows (Total: ${totalLoaded})`);

                if (onPartialResults) {
                    onPartialResults(rows, totalLoaded);
                }
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                await logHistory(`ERROR: Failed to download shard ${fileName}: ${error.message}`);

                // Store first error and clear queue to stop all workers
                if (!firstError) {
                    firstError = new Error(`Failed to download shard ${fileName}: ${error.message}`);
                    queue.length = 0; // Clear queue to stop other workers
                }
                break; // Exit this worker
            }
        }
    });

    await Promise.all(workers);

    // If any error occurred, throw it to prevent partial data load
    if (firstError) {
        await logHistory(`FAILED: Data load incomplete due to error`);
        throw firstError;
    }

    // console.log(`✅ GCS Sync Complete. Loaded ${totalLoaded} rows.`);
    await logHistory(`SUCCESS: All shards processed. Total rows: ${totalLoaded}`);

    return { rows: [], schema: [] };
};
