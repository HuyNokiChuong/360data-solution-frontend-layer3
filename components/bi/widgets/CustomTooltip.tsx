import React from 'react';
import { formatBIValue } from '../engine/utils';
import { PivotValue } from '../types';

interface CustomTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    aggregation?: string;
    valueFormatter?: (value: number) => string;
    valueFormat?: string;
    configs?: PivotValue[];
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({
    active,
    payload,
    label,
    aggregation,
    valueFormatter,
    valueFormat = 'standard',
    configs = []
}) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white dark:bg-slate-900/95 border border-slate-200 dark:border-white/10 p-2 rounded-lg shadow-xl backdrop-blur-sm min-w-[120px] pointer-events-none select-none z-50">
                <p className="font-bold text-slate-900 dark:text-white mb-1.5 text-[11px] border-b border-slate-100 dark:border-white/10 pb-1">
                    {label}
                </p>
                <div className="space-y-0.5 max-h-[250px] overflow-y-auto custom-scrollbar pr-1">
                    {payload
                        .filter((entry: any) => entry.value !== 0 && entry.value !== null && entry.value !== undefined)
                        .map((entry: any, index: number) => {
                            const config = configs.find(c => c.field === entry.name || c.alias === entry.name);
                            const formatToUse = (config?.format && config.format !== 'standard' ? config.format : null) || valueFormat || 'standard';

                            return (
                                <div key={index} className="flex items-center justify-between gap-3 text-[10px] py-0.5">
                                    <div className="flex items-center gap-1.5">
                                        <span
                                            className="w-1.5 h-1.5 rounded-full shadow-sm"
                                            style={{ backgroundColor: entry.color || entry.fill }}
                                        />
                                        <span className="text-slate-600 dark:text-slate-300 truncate max-w-[80px]">{entry.name}</span>
                                    </div>
                                    <span className="text-slate-900 dark:text-white font-mono font-medium">
                                        {valueFormatter
                                            ? valueFormatter(entry.value)
                                            : formatBIValue(entry.value, formatToUse)
                                        }
                                    </span>
                                </div>
                            );
                        })}
                </div>
                {aggregation && (
                    <div className="mt-2 pt-1 border-t border-white/5 text-[9px] font-bold text-slate-500 tracking-wider uppercase text-right">
                        Agg: {aggregation}
                    </div>
                )}
            </div>
        );
    }
    return null;
};

export default CustomTooltip;
