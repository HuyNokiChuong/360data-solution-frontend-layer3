/**
 * Batch fetch metadata (row counts + schemas) for multiple tables
 * This is optimized for loading many tables at once
 */
export interface TableMetadata {
    tableId: string;
    rowCount: number;
    schema: { name: string, type: string }[];
}

const ROW_COUNT_CONCURRENCY = 8;

export const fetchBatchTableMetadata = async (
    token: string,
    projectId: string,
    datasetId: string,
    tableIds: string[]
): Promise<Record<string, TableMetadata>> => {
    const result: Record<string, TableMetadata> = {};

    try {
        // Initialize result with empty schemas
        tableIds.forEach(tid => {
            result[tid] = { tableId: tid, rowCount: 0, schema: [] };
        });

        if (tableIds.length === 0) return result;

        // 1. Fetch row counts from Table metadata API (numRows).
        // This avoids frequent 400 errors from querying __TABLES__ on some projects.
        try {
            for (let i = 0; i < tableIds.length; i += ROW_COUNT_CONCURRENCY) {
                const chunk = tableIds.slice(i, i + ROW_COUNT_CONCURRENCY);
                await Promise.all(chunk.map(async (tableId) => {
                    const encodedTableId = encodeURIComponent(tableId);
                    const tableResponse = await fetch(
                        `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables/${encodedTableId}`,
                        {
                            method: 'GET',
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        }
                    );

                    if (!tableResponse.ok) {
                        if (tableResponse.status === 401) throw new Error('UNAUTHORIZED');
                        if (tableResponse.status === 404) return;
                        const errorPayload = await tableResponse.json().catch(() => ({}));
                        const details = errorPayload?.error?.message || tableResponse.statusText;
                        throw new Error(`Row count metadata failed for ${tableId}: ${details}`);
                    }

                    const tableMeta = await tableResponse.json().catch(() => ({}));
                    const numRows = Number.parseInt(String(tableMeta?.numRows ?? '0'), 10);
                    if (result[tableId]) {
                        result[tableId].rowCount = Number.isFinite(numRows) ? numRows : 0;
                    }
                }));
            }
            console.log(`✅ Batch fetched row counts for ${tableIds.length} tables in ${datasetId}`);
        } catch (e) {
            console.warn("Failed to batch fetch row counts:", e);
        }

        // 2. Batch fetch schemas using INFORMATION_SCHEMA.COLUMNS
        try {
            const tableIdsFilter = tableIds.map(t => `'${t}'`).join(', ');
            const schemaQuery = `
                SELECT table_name, column_name, data_type 
                FROM \`${projectId}.${datasetId}.INFORMATION_SCHEMA.COLUMNS\` 
                WHERE table_name IN (${tableIdsFilter})
                ORDER BY table_name, ordinal_position
            `;
            const schemaResponse = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: schemaQuery, useLegacySql: false }),
            });

            if (!schemaResponse.ok) {
                if (schemaResponse.status === 401) throw new Error('UNAUTHORIZED');
                throw new Error(`Schema query failed: ${schemaResponse.statusText}`);
            }

            if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                (schemaData.rows || []).forEach((row: any) => {
                    const tname = row.f[0].v;
                    const cname = row.f[1].v;
                    const dtype = row.f[2].v;
                    if (result[tname]) {
                        result[tname].schema.push({ name: cname, type: dtype });
                    }
                });
                console.log(`✅ Batch fetched schemas for ${tableIds.length} tables in ${datasetId}`);
            }
        } catch (e) {
            console.warn("Failed to batch fetch schemas:", e);
        }

        return result;
    } catch (error) {
        console.error('Failed to fetch batch table metadata:', error);
        return result;
    }
};
