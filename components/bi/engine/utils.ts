/**
 * Safe field value getter that handles case-insensitivity and virtual hierarchy fields
 */
export function getFieldValue(row: any, fieldName: string): any {
    if (!row || !fieldName) return undefined;

    if (fieldName.includes('.__')) {
        const [baseField, suffix] = fieldName.split('.__');
        const rawValue = getFieldValue(row, baseField);
        if (!rawValue) return undefined;

        let date = new Date(rawValue);

        // Retry parsing if invalid
        if (isNaN(date.getTime())) {
            // Check if it's a numeric timestamp (string or number)
            const numVal = Number(rawValue);
            if (!isNaN(numVal)) {
                // If small number, likely seconds (BigQuery often returns seconds for TIMESTAMP)
                // If large, likely milliseconds
                if (numVal < 10000000000) {
                    date = new Date(numVal * 1000);
                } else {
                    date = new Date(numVal);
                }
            } else if (typeof rawValue === 'string') {
                // Try replacing common separators if standard ISO, but rare case
                // E.g. 2023/01/01
                const cleaned = rawValue.replace(/\//g, '-');
                date = new Date(cleaned);
            }
        }

        if (isNaN(date.getTime())) return 'Unknown';

        const year = date.getFullYear();
        const monthNum = date.getMonth(); // 0-11

        switch (suffix) {
            case 'year': return String(year);
            case 'half': return `${year} H${monthNum < 6 ? '1' : '2'}`;
            case 'quarter': return `${year} Q${Math.floor(monthNum / 3) + 1}`;
            case 'month': return `${year}-${String(monthNum + 1).padStart(2, '0')}`;
            case 'day': return date.toISOString().split('T')[0];
            default: return String(year);
        }
    }

    // 2. Exact match
    if (row[fieldName] !== undefined) return row[fieldName];

    // 3. Try case-insensitive and trimmed match
    const lowerName = fieldName.toLowerCase().trim();
    const actualKey = Object.keys(row).find(k => k.toLowerCase().trim() === lowerName);
    return actualKey ? row[actualKey] : undefined;
}

/**
 * Global value formatter for BI widgets.
 * Handles numeric formatting with multiple professional styles.
 */
export function formatBIValue(value: any, valueFormat: string = 'standard'): string {
    if (value === null || value === undefined || value === '') return '-';

    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (isNaN(num)) return String(value);

    // Common formatters
    const standardFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const integerFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 });
    const currencyUSDFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const currencyVNDFormatter = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });

    switch (valueFormat) {
        case 'integer':
            return integerFormatter.format(num);

        case 'compact':
            return compactFormatter.format(num);

        case 'currency':
        case 'currency_usd':
            return currencyUSDFormatter.format(num);

        case 'currency_vnd':
            return currencyVNDFormatter.format(num);

        case 'percentage':
            return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(num / 100);

        case 'percentage_0':
            return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num / 100);

        case 'percentage_2':
            return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num / 100);

        case 'standard':
        default:
            return standardFormatter.format(num);
    }
}
