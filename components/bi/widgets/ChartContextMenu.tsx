import React, { useEffect, useRef } from 'react';
import { useLanguageStore } from '../../../store/languageStore';

interface ChartContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onAnalyze: (outputLanguage: 'vi' | 'en') => void;
}

import { createPortal } from 'react-dom';

const ChartContextMenu: React.FC<ChartContextMenuProps> = ({ x, y, onClose, onAnalyze }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const { language } = useLanguageStore();
    const analyzeViLabel = language === 'en' ? 'Analyze in Vietnamese' : 'Phân tích bằng Tiếng Việt';
    const analyzeEnLabel = language === 'en' ? 'Analyze in English' : 'Phân tích bằng Tiếng Anh';

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleScroll = () => {
            onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('scroll', handleScroll, true);
        };
    }, [onClose]);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[9999] bg-slate-900 border border-indigo-500/30 rounded-lg shadow-xl py-1 w-64 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: y, left: x }}
        >
            <button
                onClick={() => {
                    onAnalyze('vi');
                    onClose();
                }}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-300 hover:bg-indigo-600/20 hover:text-white transition-colors flex items-center gap-2 group"
            >
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <i className="fas fa-wand-magic-sparkles text-[10px] text-white"></i>
                </div>
                <span>{analyzeViLabel}</span>
            </button>
            <button
                onClick={() => {
                    onAnalyze('en');
                    onClose();
                }}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-300 hover:bg-indigo-600/20 hover:text-white transition-colors flex items-center gap-2 group"
            >
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <i className="fas fa-language text-[10px] text-white"></i>
                </div>
                <span>{analyzeEnLabel}</span>
            </button>
        </div>,
        document.body
    );
};

export default ChartContextMenu;
