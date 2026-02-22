
import React from 'react';

interface ColorPickerProps {
    value: string;
    onChange: (color: string) => void;
    label?: string;
}

const PRESET_COLORS = [
    '#6366f1', // Indigo
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#f59e0b', // Amber
    '#10b981', // Emerald
    '#3b82f6', // Blue
    '#14b8a6', // Teal
    '#f97316', // Orange
    '#ef4444', // Red
    '#84cc16', // Lime
    '#06b6d4', // Cyan
    '#a855f7', // Violet
];

const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange, label }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [customColor, setCustomColor] = React.useState(value);

    const handleColorSelect = (color: string) => {
        onChange(color);
        setCustomColor(color);
        setIsOpen(false);
    };

    return (
        <div className="relative">
            {label && (
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                    {label}
                </label>
            )}

            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full h-10 rounded-lg border border-white/10 flex items-center gap-3 px-3 hover:border-indigo-500/30 transition-colors"
            >
                <div
                    className="w-6 h-6 rounded border border-white/20"
                    style={{ backgroundColor: value }}
                ></div>
                <span className="text-xs text-slate-300 font-mono">{value.toUpperCase()}</span>
                <i className={`fas fa-chevron-down ml-auto text-slate-500 text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    ></div>
                    <div className="absolute top-full mt-2 left-0 w-64 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-20 p-3">
                        {/* Preset Colors */}
                        <div className="mb-3">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                Preset Colors
                            </div>
                            <div className="grid grid-cols-6 gap-2">
                                {PRESET_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        onClick={() => handleColorSelect(color)}
                                        className={`w-8 h-8 rounded border-2 transition-all hover:scale-110 ${value === color ? 'border-white ring-2 ring-indigo-500' : 'border-white/20'
                                            }`}
                                        style={{ backgroundColor: color }}
                                        title={color}
                                    ></button>
                                ))}
                            </div>
                        </div>

                        {/* Custom Color Input */}
                        <div className="pt-3 border-t border-white/10">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                Custom Color
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={customColor}
                                    onChange={(e) => setCustomColor(e.target.value)}
                                    className="w-10 h-10 rounded border border-white/10 cursor-pointer"
                                />
                                <input
                                    type="text"
                                    value={customColor}
                                    onChange={(e) => setCustomColor(e.target.value)}
                                    className="flex-1 bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono"
                                    placeholder="#000000"
                                />
                                <button
                                    onClick={() => handleColorSelect(customColor)}
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded transition-all"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>

                        {/* Transparency Slider */}
                        <div className="pt-3 border-t border-white/10 mt-3">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                Opacity
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                defaultValue="100"
                                className="w-full"
                            />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ColorPicker;
