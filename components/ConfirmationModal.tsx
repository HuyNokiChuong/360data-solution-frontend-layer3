
import React from 'react';
import { useLanguageStore } from '../store/languageStore';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    cancelText,
    type = 'danger'
}) => {
    const { t } = useLanguageStore();
    if (!isOpen) return null;

    const effectiveConfirmText = confirmText || t('confirm.confirm');
    const effectiveCancelText = cancelText || t('confirm.cancel');

    const colors = {
        danger: {
            bg: 'bg-red-600',
            hover: 'hover:bg-red-500',
            shadow: 'shadow-red-600/30',
            icon: 'text-red-500',
            iconBg: 'bg-red-500/10'
        },
        warning: {
            bg: 'bg-yellow-600',
            hover: 'hover:bg-yellow-500',
            shadow: 'shadow-yellow-600/30',
            icon: 'text-yellow-500',
            iconBg: 'bg-yellow-500/10'
        },
        info: {
            bg: 'bg-indigo-600',
            hover: 'hover:bg-indigo-500',
            shadow: 'shadow-indigo-600/30',
            icon: 'text-indigo-500',
            iconBg: 'bg-indigo-500/10'
        }
    };

    const theme = colors[type];

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-white/10 rounded-[2rem] w-[480px] shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-8 pb-0">
                    <div className="flex gap-6">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${theme.iconBg} ${theme.icon}`}>
                            {type === 'danger' && <i className="fas fa-trash-alt text-2xl"></i>}
                            {type === 'warning' && <i className="fas fa-exclamation-triangle text-2xl"></i>}
                            {type === 'info' && <i className="fas fa-info-circle text-2xl"></i>}
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-tight mb-2">
                                {title}
                            </h3>
                            <p className="text-slate-500 dark:text-slate-400 text-sm font-medium leading-relaxed">
                                {message}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-8 flex justify-end gap-3 mt-4">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10"
                    >
                        {effectiveCancelText}
                    </button>
                    <button
                        onClick={() => { onConfirm(); onClose(); }}
                        className={`px-8 py-3 rounded-xl text-white ${theme.bg} ${theme.hover} ${theme.shadow} shadow-lg transition-all font-black text-xs uppercase tracking-widest active:scale-95 flex items-center gap-2`}
                    >
                        <span>{effectiveConfirmText}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
