/**
 * Batch fetch metadata (row counts + schemas) for multiple tables
 * This is optimized for loading many tables at once
 */
export interface TableMetadata {
    tableId: string;
    rowCount: number;
    schema: { name: string, type: string }[];
}

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

        // 1. Batch fetch row counts using __TABLES__
        try {
            const tableIdsFilter = tableIds.map(t => `'${t}'`).join(', ');
            const countQuery = `SELECT table_id, row_count FROM \`${projectId}.${datasetId}.__TABLES__\` WHERE table_id IN (${tableIdsFilter})`;
            const countResponse = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: countQuery, useLegacySql: false }),
            });

            if (!countResponse.ok) {
                if (countResponse.status === 401) throw new Error('UNAUTHORIZED');
                throw new Error(`Row count query failed: ${countResponse.statusText}`);
            }

            if (countResponse.ok) {
                const countData = await countResponse.json();
                (countData.rows || []).forEach((row: any) => {
                    const tid = row.f[0].v;
                    const count = parseInt(row.f[1].v) || 0;
                    if (result[tid]) {
                        result[tid].rowCount = count;
                    }
                });
                console.log(`✅ Batch fetched row counts for ${tableIds.length} tables in ${datasetId}`);
            }
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
