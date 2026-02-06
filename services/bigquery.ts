
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

export const fetchProjects = async (token: string): Promise<Project[]> => {
    let projects: Project[] = [];
    let pageToken: string | undefined;

    try {
        do {
            const url = new URL('https://bigquery.googleapis.com/bigquery/v2/projects');
            url.searchParams.append('maxResults', '1000');
            if (pageToken) url.searchParams.append('pageToken', pageToken);

            const response = await fetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
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
        console.error(error);
        return projects;
    }
};

export const fetchDatasets = async (token: string, projectId: string): Promise<Dataset[]> => {
    let datasets: Dataset[] = [];
    let pageToken: string | undefined;

    try {
        do {
            const url = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets`);
            url.searchParams.append('maxResults', '1000');
            if (pageToken) url.searchParams.append('pageToken', pageToken);

            const response = await fetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
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
        console.error(error);
        return datasets;
    }
};

export const fetchTables = async (token: string, projectId: string, datasetId: string): Promise<Table[]> => {
    let tables: Table[] = [];
    let pageToken: string | undefined;

    try {
        // 1. Fetch tables list (to get IDs and pagination)
        do {
            const url = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`);
            url.searchParams.append('maxResults', '1000');
            if (pageToken) url.searchParams.append('pageToken', pageToken);

            const response = await fetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
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
            const queryResponse = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, useLegacySql: false }),
            });

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
            console.warn("Failed to fetch row counts via query", e);
        }

        // 3. Fetch schemas using INFORMATION_SCHEMA.COLUMNS
        try {
            const schemaQuery = `SELECT table_name, column_name, data_type FROM \`${projectId}.${datasetId}.INFORMATION_SCHEMA.COLUMNS\` ORDER BY table_name, ordinal_position`;
            const schemaResponse = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: schemaQuery, useLegacySql: false }),
            });

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
            console.warn("Failed to fetch schemas via query", e);
        }

        return tables;
    } catch (error) {
        console.error(error);
        return tables;
    }
}

const fetchWithRetry = async (url: string, options: any, retries = 3, backoff = 1000): Promise<Response> => {
    try {
        // Enforce a 30s timeout if not present in options
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        // If options.signal exists, we strictly should respect it, but we also want a timeout.
        // Merging signals is complex, so we'll just use the timeout if no signal, 
        // or rely on the caller's signal. 
        // Ideally: use a wrapper to race the caller signal and our timeout.
        // For simplicity: We will rely on the fetch call's timeout pattern.

        const finalOptions = { ...options };
        if (!finalOptions.signal) {
            finalOptions.signal = controller.signal;
        }

        const response = await fetch(url, finalOptions).finally(() => clearTimeout(timeoutId));

        if (response.ok) return response;

        // Only retry on transient errors (5xx) or rate limits (429)
        if (retries > 0 && (response.status >= 500 || response.status === 429)) {
            console.warn(`⏳ Request failed (${response.status}). Retrying in ${backoff}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        return response;
    } catch (error: any) {
        if (error.name === 'AbortError') throw error; // Don't retry aborts

        if (retries > 0) {
            console.warn(`⏳ Network error. Retrying in ${backoff}ms...`, error);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw error;
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
        console.log('🔍 fetchTableData: Starting fetch for', { projectId, datasetId, tableId, limit });

        const query = `SELECT * FROM \`${projectId}.${datasetId}.${tableId}\`${limit ? ` LIMIT ${limit}` : ''}`;

        // 1. Start the Query - Request a smaller initial batch for instant UI feedback
        const INITIAL_BATCH_SIZE = 50000;
        let response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
                useLegacySql: false,
                timeoutMs: 30000,
                maxResults: limit ? Math.min(limit, INITIAL_BATCH_SIZE) : INITIAL_BATCH_SIZE
            }),
            signal
        });

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
            console.log(`⏳ Job ${jobId} not complete. Waiting ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));

            const pollUrl = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`);
            pollUrl.searchParams.append('maxResults', (limit ? Math.min(limit, INITIAL_BATCH_SIZE) : INITIAL_BATCH_SIZE).toString());
            if (location) pollUrl.searchParams.append('location', location);

            const pollResp = await fetch(pollUrl.toString(), {
                headers: { Authorization: `Bearer ${token}` },
                signal
            });

            if (!pollResp.ok) {
                const err = await pollResp.json().catch(() => ({}));
                console.error("❌ Polling failed:", err);
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
            const CHUNK_SIZE = 25000; // Increased chunk size to reduce switching overhead

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
            console.log("🔄 Initial rows empty but data exists. Fetching first page via pageToken...");
            const nextUrl = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`);
            nextUrl.searchParams.append('pageToken', pageToken);
            nextUrl.searchParams.append('maxResults', (limit ? Math.min(limit, INITIAL_BATCH_SIZE) : INITIAL_BATCH_SIZE).toString());
            if (location) nextUrl.searchParams.append('location', location);

            const nextResp = await fetch(nextUrl.toString(), {
                headers: { Authorization: `Bearer ${token}` },
                signal
            });

            if (nextResp.ok) {
                const nextData = await nextResp.json();
                currentRows = nextData.rows || [];
                pageToken = nextData.pageToken;
            }
        }

        let parsedRows = await parseRowsAsync(currentRows);

        if (onPartialResults) {
            onPartialResults(parsedRows, totalRows);
        }

        // 5. High-Speed Parallel Fetching for Subsequent Pages
        let totalItemsFetched = currentRows.length;
        const PARALLEL_CHUNK_SIZE = 50000; // Keep at 50k to balance memory usage and request count
        // Maximize concurrency to browser limit (usually 6 for HTTP/1.1, more for HTTP/2)
        const CONCURRENCY = 8;

        if (totalRows > totalItemsFetched && (!limit || totalItemsFetched < limit)) {
            const startOffset = totalItemsFetched;
            const endOffset = limit ? Math.min(totalRows, limit) : totalRows;
            const totalToFetch = endOffset - startOffset;

            const chunkStarts: number[] = [];
            for (let i = startOffset; i < endOffset; i += PARALLEL_CHUNK_SIZE) {
                chunkStarts.push(i);
            }

            console.log(`🚀 Slicing ${totalToFetch} rows into ${chunkStarts.length} parallel batches (Concurrency: ${CONCURRENCY})...`);

            const fetchChunk = async (startIndex: number) => {
                const targetChunkSize = Math.min(PARALLEL_CHUNK_SIZE, endOffset - startIndex);
                if (targetChunkSize <= 0) return;

                let fetchedCount = 0;
                let currentStartIndex = startIndex;

                // Keep fetching until we fill the chunk or run out of data
                while (fetchedCount < targetChunkSize) {
                    const remaining = targetChunkSize - fetchedCount;
                    const maxResults = remaining;

                    const chunkUrl = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`);
                    chunkUrl.searchParams.append('startIndex', currentStartIndex.toString());
                    chunkUrl.searchParams.append('maxResults', maxResults.toString());
                    if (location) chunkUrl.searchParams.append('location', location);

                    try {
                        const resp = await fetchWithRetry(chunkUrl.toString(), {
                            headers: { Authorization: `Bearer ${token}` },
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
                            if (onPartialResults) {
                                onPartialResults(parsed, totalRows);
                            }
                            fetchedCount += rowCount;
                            currentStartIndex += rowCount;
                        } else {
                            if (fetchedCount < targetChunkSize) {
                                console.warn(`⚠️ Batch at ${currentStartIndex} returned 0 rows but expected ${remaining} more. Stopping chunk early.`);
                            }
                            break;
                        }
                    } catch (error) {
                        console.error(`❌ Failed to fetch sub-chunk at ${currentStartIndex}:`, error);
                        throw error;
                    }
                }
            };

            const pool = [...chunkStarts];
            const workers = Array(CONCURRENCY).fill(null).map(async () => {
                while (pool.length > 0) {
                    const start = pool.shift();
                    if (start !== undefined) {
                        await fetchChunk(start);
                    }
                }
            });

            await Promise.all(workers);
            console.log(`✅ All workers finished for ${tableId}.`);
        }

        console.log(`✅ Parallel Data Sync Complete.`);
        return { rows: [], schema }; // Return empty rows because they are already pushed via onPartialResults
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.log('⏹️ fetchTableData aborted.');
            throw error;
        }
        console.error('❌ fetchTableData CRITICAL error:', error);
        if (error instanceof Error) {
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
        }
        throw error;
    }
};


export const fetchTableSchema = async (token: string, projectId: string, datasetId: string, tableId: string): Promise<{ name: string, type: string }[]> => {
    try {
        const query = `SELECT column_name, data_type FROM \`${projectId}.${datasetId}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = '${tableId}' ORDER BY ordinal_position`;
        const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, useLegacySql: false }),
        });

        if (!response.ok) throw new Error('Failed to fetch schema');
        const data = await response.json();
        return (data.rows || []).map((row: any) => ({
            name: row.f[0].v,
            type: row.f[1].v
        }));
    } catch (error) {
        console.error('Failed to fetch schema:', error);
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
        dimensions: string[];
        measures: { field: string; aggregation: string }[];
        filters?: any[];
        limit?: number;
        signal?: AbortSignal;
    }
): Promise<any[]> => {
    const { dimensions, measures, filters, limit, signal } = options;

    // 1. Build SELECT clause
    const selectParts = [
        ...dimensions.map(d => `\`${d}\``),
        ...measures.map(m => {
            const agg = m.aggregation.toUpperCase() === 'COUNTDISTINCT' ? 'COUNT(DISTINCT' : `${m.aggregation.toUpperCase()}(`;
            return `${agg} \`${m.field}\`${m.aggregation.toUpperCase() === 'COUNTDISTINCT' ? ')' : ')'} as \`${m.field}_${m.aggregation}\``;
        })
    ];

    // 2. Build WHERE clause (simple version for now)
    let whereClause = '';
    if (filters && filters.length > 0) {
        const filterParts = filters.map(f => {
            if (!f.enabled) return null;
            const val = typeof f.value === 'string' ? `'${f.value}'` : f.value;
            switch (f.operator) {
                case 'equals': return `\`${f.field}\` = ${val}`;
                case 'notEquals': return `\`${f.field}\` != ${val}`;
                case 'contains': return `\`${f.field}\` LIKE '%${f.value}%'`;
                case 'greaterThan': return `\`${f.field}\` > ${val}`;
                case 'lessThan': return `\`${f.field}\` < ${val}`;
                default: return null;
            }
        }).filter(Boolean);

        if (filterParts.length > 0) {
            whereClause = ` WHERE ${filterParts.join(' AND ')}`;
        }
    }

    // 3. Build GROUP BY clause
    const groupByClause = dimensions.length > 0 ? ` GROUP BY ${dimensions.map((_, i) => i + 1).join(', ')}` : '';

    // 4. Build Final Query
    const query = `SELECT ${selectParts.join(', ')} FROM \`${projectId}.${datasetId}.${tableId}\`${whereClause}${groupByClause}${limit ? ` LIMIT ${limit}` : ''}`;

    console.log('🚀 Remote Aggregation Query:', query);

    const results = await runQuery(token, projectId, query);
    return results;
};

export const runQuery = async (token: string, projectId: string, query: string): Promise<any[]> => {
    try {
        const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, useLegacySql: false, timeoutMs: 30000, maxResults: 1000000 }),
        });

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
                const pollResp = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}${location ? `?location=${location}` : ''}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                data = await pollResp.json();
                waitTime = Math.min(waitTime * 1.5, 5000);
            }
        }
        return parseBigQueryResponse(data);
    } catch (error) {
        console.error("Query Execution Error:", error);
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
                    val = val !== null ? parseFloat(val) : 0;
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
    console.log(`🧹 Clearing GCS folder: gs://${bucketName}/${prefix}`);

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
                }).catch(e => console.warn(`Failed to delete ${item.name}`, e))
            );
            await Promise.all(deletePromises);
            console.log(`Deleted ${items.length} files from ${prefix}`);
        }

        pageToken = listData.nextPageToken;
    } while (pageToken);
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

    console.log(`🚀 Starting BigQuery Export Job: ${tableId} -> ${destinationUri}`);

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

        console.log(`⏳ Waiting for export job ${jobId}...`);
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

    console.log('✅ Export Job Complete via API.');

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

    const text = await response.text();
    return parseJSONL(text);
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

    console.log(`📦 Found ${fileNames.length} shards on GCS. Downloading in parallel...`);

    // 2. Download in Parallel (Browser limit ~6)
    const CONCURRENCY = 6;
    let totalLoaded = 0;

    const queue = [...fileNames];
    const workers = Array(CONCURRENCY).fill(null).map(async () => {
        while (queue.length > 0) {
            const fileName = queue.shift();
            if (!fileName || signal?.aborted) break;

            try {
                const rows = await downloadGCSFile(token, bucketName, fileName, signal);
                totalLoaded += rows.length;
                if (onPartialResults) {
                    onPartialResults(rows, totalLoaded);
                }
            } catch (e) {
                console.error(`Failed to download shard ${fileName}`, e);
            }
        }
    });

    await Promise.all(workers);
    console.log(`✅ GCS Sync Complete. Loaded ${totalLoaded} rows.`);

    return { rows: [], schema: [] };
};

