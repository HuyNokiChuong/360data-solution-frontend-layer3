/**
 * Safe field value getter that handles case-insensitivity and virtual hierarchy fields
 */
export function getFieldValue(row: any, fieldName: string): any {
    if (!row || !fieldName) return undefined;

    // 1. Exact match (HIGHEST PRIORITY)
    // This handles cases where the SQL query returns the pre-calculated virtual field directly (e.g. "date___year")
    if (row[fieldName] !== undefined) return row[fieldName];

    // 2. Case-insensitive exact match
    // BigQuery aliases might be case-insensitive
    const lowerName = fieldName.toLowerCase().trim();
    const actualKey = Object.keys(row).find(k => k.toLowerCase().trim() === lowerName);
    if (actualKey) return row[actualKey];

    // 3. Virtual Hierarchy Logic (___)
    // Only used if the direct field was NOT found in the row (e.g. client-side derivation from raw date)
    if (fieldName.includes('___')) {
        const [baseField, suffix] = fieldName.split('___');
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

    return undefined;
}

/**
 * Global value formatter for BI widgets.
 * Handles numeric formatting with multiple professional styles.
 */
const getNumberFormatter = (locale: string, options: Intl.NumberFormatOptions) => {
    try {
        return new Intl.NumberFormat(locale, options);
    } catch (e) {
        return new Intl.NumberFormat('en-US', options);
    }
};

export function formatBIValue(value: any, valueFormat: string = 'standard'): string {
    if (value === null || value === undefined || value === '') return '-';

    // Handle Dates first
    if (valueFormat.startsWith('date:') || valueFormat.startsWith('datetime:') || valueFormat.startsWith('time:')) {
        const date = new Date(value);
        if (isNaN(date.getTime())) return String(value);

        // Updated default to YYYY/MM/DD as requested
        const formatStr = valueFormat.split(':')[1] || 'YYYY/MM/DD';

        const pad = (n: number) => n.toString().padStart(2, '0');
        const year = date.getFullYear();
        const monthIndex = date.getMonth();
        const month = pad(monthIndex + 1);
        const day = pad(date.getDate());
        const hours24 = date.getHours();
        const hours12 = hours24 % 12 || 12;
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        const ampm = hours24 >= 12 ? 'PM' : 'AM';
        const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

        let formatted = formatStr
            .replace('YYYY', String(year))
            .replace('YY', String(year).slice(-2))
            .replace('MMMM', monthsLong[monthIndex])
            .replace('MMM', monthsShort[monthIndex])
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', pad(hours24))
            .replace('hh', pad(hours12))
            .replace('mm', minutes)
            .replace('ss', seconds)
            .replace('A', ampm);

        return formatted;
    }

    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (isNaN(num)) return String(value);

    switch (valueFormat.toLowerCase()) {
        case 'integer':
            return getNumberFormatter('en-US', { maximumFractionDigits: 0 }).format(num);

        case 'compact':
        case '1k':
            return getNumberFormatter('en-US', {
                notation: 'compact',
                compactDisplay: 'short',
                maximumFractionDigits: 1
            }).format(num);

        case 'compact_long':
            return getNumberFormatter('en-US', {
                notation: 'compact',
                compactDisplay: 'long',
                maximumFractionDigits: 1
            }).format(num);

        case '1m':
            return (num / 1000000).toFixed(1) + 'M';

        case '1b':
            return (num / 1000000000).toFixed(1) + 'B';

        case 'scientific':
            return num.toExponential(2);

        case 'accounting':
            return getNumberFormatter('en-US', {
                style: 'currency',
                currency: 'USD',
                currencySign: 'accounting'
            }).format(num);

        case 'currency':
        case 'currency_usd':
            return getNumberFormatter('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0
            }).format(num);

        case 'currency_vnd':
            return getNumberFormatter('vi-VN', {
                style: 'currency',
                currency: 'VND'
            }).format(num);

        case 'currency_eur':
            return getNumberFormatter('de-DE', {
                style: 'currency',
                currency: 'EUR'
            }).format(num);

        case 'currency_gbp':
            return getNumberFormatter('en-GB', {
                style: 'currency',
                currency: 'GBP'
            }).format(num);

        case 'currency_jpy':
            return getNumberFormatter('ja-JP', {
                style: 'currency',
                currency: 'JPY'
            }).format(num);

        case 'percentage':
            return getNumberFormatter('en-US', {
                style: 'percent',
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
            }).format(num / 100);

        case 'percentage_0':
            return getNumberFormatter('en-US', {
                style: 'percent',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(num / 100);

        case 'percentage_2':
            return getNumberFormatter('en-US', {
                style: 'percent',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(num / 100);

        case 'float_1':
            return num.toFixed(1);

        case 'float_2':
            return num.toFixed(2);

        case 'float_3':
            return num.toFixed(3);

        case 'float_4':
            return num.toFixed(4);

        case 'smart_axis':
            if (Math.abs(num) >= 1000000000) return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
            if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
            if (Math.abs(num) >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return getNumberFormatter('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            }).format(num);

        case 'standard':
        default:
            // User requested default to be float (with decimals)
            return getNumberFormatter('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(num);
    }
}
