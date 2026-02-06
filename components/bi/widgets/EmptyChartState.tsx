
import React from 'react';
import { ChartType } from '../types';

interface EmptyChartStateProps {
    type: string;
    message?: string;
    onClickDataTab?: () => void;
    onClick?: (e: React.MouseEvent) => void;
}

const EmptyChartState: React.FC<EmptyChartStateProps> = ({ type, message, onClickDataTab, onClick }) => {
    const getIcon = (type: string) => {
        switch (type) {
            case 'bar': return 'fa-chart-column';
            case 'horizontalBar': return 'fa-chart-bar';
            case 'line': return 'fa-chart-line';
            case 'pie': return 'fa-chart-pie';
            case 'donut': return 'fa-circle-dot';
            case 'scatter': return 'fa-braille';
            case 'combo': return 'fa-chart-line';
            case 'table': return 'fa-table-list';
            case 'card': return 'fa-bolt';
            case 'gauge': return 'fa-tachometer-alt';
            default: return 'fa-chart-bar';
        }
    };

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                if (onClick) onClick(e);
                onClickDataTab?.();
            }}
            className="flex flex-col items-center justify-center h-full w-full p-6 text-center select-none cursor-pointer group hover:bg-white/[0.02] transition-colors"
        >
            <div className="relative mb-8 transition-transform group-hover:scale-105 duration-500">
                {/* Visual Accent */}
                <div className="absolute inset-0 bg-indigo-500/10 blur-[40px] rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>

                {/* Large Background Icon */}
                <i className={`fas ${getIcon(type)} text-8xl text-slate-800/40 relative z-10 group-hover:text-slate-700/50 transition-colors`}></i>

                {/* Smaller Plus Icon overlay */}
                <div
                    className="absolute -bottom-2 -right-2 w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center border border-white/5 shadow-2xl z-20 group-hover:border-indigo-500/30 transition-all"
                >
                    <i className="fas fa-plus text-xs text-indigo-500 animate-pulse group-hover:scale-125 transition-transform"></i>
                </div>
            </div>

            <div className="max-w-[240px] space-y-3 relative z-10">
                <p className="text-white/80 font-black text-sm uppercase tracking-[0.2em] group-hover:text-indigo-400 transition-colors">
                    {message || (type === 'card' || type === 'table' ? 'SELECT DATA FIELDS' : 'SELECT X-AXIS FIELD')}
                </p>
                <div className="h-px w-8 bg-indigo-500/30 mx-auto group-hover:w-16 transition-all duration-500"></div>
                <p className="text-slate-500 text-[10px] leading-relaxed group-hover:text-slate-400 transition-colors">
                    Click anywhere or drag fields from the <span className="text-indigo-400 font-black">Data</span> tab to start visualizing.
                </p>
            </div>
        </div>
    );
};

export default EmptyChartState;
