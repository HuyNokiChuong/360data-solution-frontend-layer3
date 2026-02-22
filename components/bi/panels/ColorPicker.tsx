import React, { useState, useRef, useEffect } from 'react';
import { HexColorPicker } from 'react-colorful';

interface ColorPickerProps {
    color: string;
    onChange: (color: string) => void;
    label?: string;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, label }) => {
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <div className="relative">
            {label && (
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                    {label}
                </label>
            )}
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-8 h-6 rounded border border-white/10 shadow-sm transition-transform hover:scale-105 active:scale-95"
                    style={{ backgroundColor: color }}
                />
                <input
                    type="text"
                    value={color}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-20 bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
            </div>

            {isOpen && (
                <div ref={popoverRef} className="absolute z-50 left-0 top-full mt-2 bg-slate-900 border border-white/10 rounded-lg p-2 shadow-xl">
                    <HexColorPicker color={color} onChange={onChange} />
                </div>
            )}
        </div>
    );
};

export default ColorPicker;
