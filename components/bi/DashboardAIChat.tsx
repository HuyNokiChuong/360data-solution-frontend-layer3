// ============================================
// Dashboard AI Chat - AI Advisor Component
// ============================================

import React, { useState, useRef, useEffect } from 'react';
import { BIDashboard } from './types';
import { DashboardConfig } from '../../types';
import { analyzeDashboardContent } from '../../services/ai';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    visualData?: DashboardConfig;
    sqlTrace?: string;
    executionTime?: number;
    timestamp: Date;
}

interface DashboardAIChatProps {
    dashboard: BIDashboard;
}

const DashboardAIChat: React.FC<DashboardAIChatProps> = ({ dashboard }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ x: window.innerWidth - 100, y: window.innerHeight - 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, buttonX: 0, buttonY: 0 });
    const [hasMoved, setHasMoved] = useState(false);

    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: `Xin chào! Tôi là AI Advisor của bạn. Tôi đã nắm được cấu trúc của dashboard "${dashboard.title}".\nBạn muốn tôi phân tích điều gì hôm nay?`,
            timestamp: new Date()
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    const handleMouseDown = (e: React.MouseEvent) => {
        setDragStart({
            x: e.clientX,
            y: e.clientY,
            buttonX: position.x,
            buttonY: position.y
        });
        setIsDragging(true);
        setHasMoved(false);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;

            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                setHasMoved(true);
            }

            setPosition({
                x: dragStart.buttonX + dx,
                y: dragStart.buttonY + dy
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragStart]);

    const handleToggle = (e: React.MouseEvent) => {
        if (!hasMoved) {
            setIsOpen(!isOpen);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || isTyping) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);

        try {
            const history = messages.map(m => ({ role: m.role, content: m.content }));
            const response = await analyzeDashboardContent(input.trim(), dashboard, history);

            const assistantMsg: Message = {
                id: `ai-${Date.now()}`,
                role: 'assistant',
                content: response,
                timestamp: new Date()
            };

            setMessages(prev => [...prev, assistantMsg]);
        } catch (error: any) {
            console.error("Chat Error:", error);
            const rawMsg = error.message || "Xin lỗi, đã có lỗi xảy ra.";
            const isLeaked = rawMsg.toLowerCase().includes('leaked');

            setMessages(prev => [...prev, {
                id: `err-${Date.now()}`,
                role: 'assistant',
                content: isLeaked
                    ? `⚠️ LỖI BẢO MẬT: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa. \n\nCÁCH KHẮC PHỤC:\n1. Truy cập https://aistudio.google.com/ \n2. Tạo API Key mới.\n3. Cập nhật vào tab 'AI Setting'.`
                    : `Error: ${rawMsg}`,
                timestamp: new Date()
            }]);
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div
            className="fixed z-[200] select-none"
            style={{
                left: position.x,
                top: position.y,
                transform: 'translate(-50%, -50%)',
                transition: isDragging ? 'none' : 'all 0.15s ease-out'
            }}
        >
            {/* Chat Panel */}
            <div className={`
                absolute bottom-16 right-0 w-[600px] h-[700px] bg-[#0f172a] border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] 
                flex flex-col overflow-hidden transition-all duration-300 origin-bottom-right
                ${isOpen ? 'scale-100 opacity-100 translate-y-0' : 'scale-90 opacity-0 translate-y-4 pointer-events-none'}
            `}>
                {/* Header */}
                <div className="p-4 bg-indigo-600 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                            <i className="fas fa-robot text-white text-xl"></i>
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-white uppercase tracking-wider">AI Advisor</h3>
                            <div className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                <span className="text-[10px] text-white/70 font-bold uppercase tracking-widest">Online Analysis</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="text-white/60 hover:text-white transition-colors p-2"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Messages Area */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-950/50"
                >
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div className={`
                                max-w-[85%] p-4 rounded-3xl text-[12px] leading-relaxed
                                ${msg.role === 'user'
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                                    : 'bg-slate-900 border border-white/10 text-slate-200'
                                }
                            `}>
                                <div className="whitespace-pre-wrap">{msg.content}</div>
                                <div className={`text-[9px] mt-1.5 opacity-50 font-bold ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>
                        </div>
                    ))}
                    {isTyping && (
                        <div className="flex justify-start">
                            <div className="bg-slate-900 border border-white/10 p-3 rounded-2xl rounded-tl-none">
                                <div className="flex gap-1">
                                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Input Area */}
                <div className="p-4 bg-slate-900 border-t border-white/5">
                    <div className="relative" onMouseDown={e => e.stopPropagation()}>
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder="Hỏi AI Advisor về dashboard này..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 pr-12 text-xs text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-600 outline-none transition-all resize-none min-h-[44px] max-h-[120px]"
                            rows={1}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isTyping}
                            className={`
                                absolute right-2 bottom-2 w-8 h-8 rounded-lg flex items-center justify-center transition-all
                                ${input.trim() && !isTyping ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-slate-800 text-slate-500'}
                            `}
                        >
                            <i className="fas fa-paper-plane text-xs"></i>
                        </button>
                    </div>
                    <div className="mt-2 text-[9px] text-slate-500 text-center font-bold uppercase tracking-widest">
                        Press Enter to send • 360data Precision AI
                    </div>
                </div>
            </div>

            {/* Floating Toggle Button */}
            <button
                onMouseDown={handleMouseDown}
                onClick={handleToggle}
                className={`
                    w-14 h-14 rounded-full flex items-center justify-center shadow-[0_10px_30px_rgba(79,70,229,0.4)]
                    transition-all duration-300 hover:scale-110 active:scale-95 cursor-grab active:cursor-grabbing
                    ${isOpen ? 'bg-slate-800 text-white rotate-180' : 'bg-indigo-600 text-white'}
                `}
            >
                {isOpen ? (
                    <i className="fas fa-times text-xl pointer-events-none"></i>
                ) : (
                    <div className="relative pointer-events-none">
                        <i className="fas fa-robot text-2xl"></i>
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 border-2 border-indigo-600 rounded-full"></span>
                    </div>
                )}
            </button>
        </div>
    );
};

export default DashboardAIChat;
