import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantRuntime } from './AssistantRuntimeProvider';
import type { AssistantMessage } from './types';

const MAX_PARALLEL_GLOBAL_REQUESTS = 3;
const FLOATING_CHAT_POSITION_KEY = 'global_assistant_chat_offset_v1';

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  moved: boolean;
}

const getStatusTone = (status: string) => {
  if (status === 'done' || status === 'undone') return 'text-emerald-400';
  if (status === 'failed' || status === 'cancelled') return 'text-red-400';
  if (status === 'waiting_confirm') return 'text-amber-400';
  if (status === 'running' || status === 'planned' || status === 'approved') return 'text-indigo-400';
  return 'text-slate-400';
};

const statusLabel = (status: string) => {
  if (status === 'waiting_confirm') return 'waiting confirm';
  if (status === 'waiting_input') return 'waiting input';
  return status || 'planned';
};

export const GlobalAssistantChat: React.FC = () => {
  const {
    globalMessages,
    isBusyGlobal,
    sendMessage,
    confirmActions,
    refreshTimeline,
    startNewSession,
  } = useAssistantRuntime();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [confirmLoadingMessageId, setConfirmLoadingMessageId] = useState<string | null>(null);
  const [timelineLoaded, setTimelineLoaded] = useState(false);
  const [isCommandBusy, setIsCommandBusy] = useState(false);
  const [localMessages, setLocalMessages] = useState<AssistantMessage[]>([]);
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>([]);
  const [inFlightPrompts, setInFlightPrompts] = useState(0);
  const inFlightPromptsRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressToggleRef = useRef(false);
  const [floatingOffset, setFloatingOffset] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(FLOATING_CHAT_POSITION_KEY);
      if (!raw) return { x: 0, y: 0 };
      const parsed = JSON.parse(raw);
      const x = Number(parsed?.x);
      const y = Number(parsed?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
      return { x, y };
    } catch {
      return { x: 0, y: 0 };
    }
  });
  const hasActiveGlobalWork = isBusyGlobal || inFlightPrompts > 0 || queuedPrompts.length > 0;
  const isInputDisabled = isCommandBusy;

  const clampOffsetToViewport = useCallback((offset: { x: number; y: number }) => {
    const container = containerRef.current;
    if (!container) return offset;

    const rect = container.getBoundingClientRect();
    const baseLeft = rect.left - offset.x;
    const baseTop = rect.top - offset.y;
    const margin = 8;
    const minX = margin - baseLeft;
    const maxX = window.innerWidth - rect.width - margin - baseLeft;
    const minY = margin - baseTop;
    const maxY = window.innerHeight - rect.height - margin - baseTop;

    return {
      x: Math.min(maxX, Math.max(minX, offset.x)),
      y: Math.min(maxY, Math.max(minY, offset.y)),
    };
  }, []);

  const appendLocalAssistantMessage = (content: string, status: AssistantMessage['status'] = 'done') => {
    setLocalMessages((prev) => [
      ...prev,
      {
        id: `local-system-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'assistant',
        content,
        status,
        missingInputs: [],
        actionPlan: [],
        pendingConfirmations: [],
      },
    ]);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [globalMessages, isBusyGlobal, isCommandBusy, localMessages, open]);

  useEffect(() => {
    const ensureInsideViewport = () => {
      setFloatingOffset((prev) => {
        const next = clampOffsetToViewport(prev);
        if (next.x === prev.x && next.y === prev.y) return prev;
        try {
          localStorage.setItem(FLOATING_CHAT_POSITION_KEY, JSON.stringify(next));
        } catch {
          // noop
        }
        return next;
      });
    };

    const rafId = requestAnimationFrame(ensureInsideViewport);
    window.addEventListener('resize', ensureInsideViewport);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', ensureInsideViewport);
    };
  }, [clampOffsetToViewport, open]);

  useEffect(() => {
    if (!open || timelineLoaded) return;
    refreshTimeline('global')
      .catch((err) => console.warn('[assistant] timeline load failed', err))
      .finally(() => setTimelineLoaded(true));
  }, [open, refreshTimeline, timelineLoaded]);

  const visibleMessages = useMemo<AssistantMessage[]>(() => {
    const merged = [...globalMessages, ...localMessages];
    if (merged.length > 0) return merged;
    return [{
      id: 'global-welcome',
      role: 'assistant',
      content: 'Xin chào. Bạn cứ nói hành động cần làm, tôi sẽ thực thi trực tiếp trên hệ thống.',
      status: 'done',
      missingInputs: [],
      actionPlan: [],
      pendingConfirmations: [],
    }];
  }, [globalMessages, localMessages]);

  const handleSlashCommand = async (rawInput: string) => {
    const [rawCommand, ...rawArgs] = rawInput.trim().split(/\s+/);
    const command = String(rawCommand || '').toLowerCase();
    const args = rawArgs.join(' ').trim();

    if (command === '/help') {
      appendLocalAssistantMessage(
        [
          'Slash commands:',
          '/clear - clear chat hiện tại',
          '/new - tạo chat session mới',
          '/refresh - tải lại timeline',
          '/undo - hoàn tác action gần nhất',
          '/goto <tab> - chuyển tab (connections|tables|reports|bi|users|data-modeling|logs)',
        ].join('\n')
      );
      return true;
    }

    if (command === '/clear' || command === '/new') {
      setIsCommandBusy(true);
      try {
        await startNewSession('global', 'Global Assistant');
        setQueuedPrompts([]);
        setLocalMessages([]);
        appendLocalAssistantMessage('Đã clear cuộc trò chuyện hiện tại.');
      } catch (err: any) {
        appendLocalAssistantMessage(`Không thể clear chat: ${err?.message || 'Unknown error.'}`, 'failed');
      } finally {
        setIsCommandBusy(false);
      }
      return true;
    }

    if (command === '/refresh') {
      setIsCommandBusy(true);
      try {
        await refreshTimeline('global');
        appendLocalAssistantMessage('Đã tải lại timeline.');
      } catch (err: any) {
        appendLocalAssistantMessage(`Không thể refresh timeline: ${err?.message || 'Unknown error.'}`, 'failed');
      } finally {
        setIsCommandBusy(false);
      }
      return true;
    }

    if (command === '/undo') {
      await sendMessage({
        channel: 'global',
        text: 'undo',
        autoExecute: true,
      });
      return true;
    }

    if (command === '/goto') {
      if (!args) {
        appendLocalAssistantMessage('Cú pháp: /goto <tab>. Ví dụ: /goto reports');
        return true;
      }
      await sendMessage({
        channel: 'global',
        text: `đi tới tab ${args}`,
        autoExecute: true,
      });
      return true;
    }

    if (command.startsWith('/')) {
      appendLocalAssistantMessage('Lệnh không hỗ trợ. Gõ /help để xem danh sách lệnh.');
      return true;
    }

    return false;
  };

  const runPrompt = useCallback(async (text: string) => {
    inFlightPromptsRef.current += 1;
    setInFlightPrompts(inFlightPromptsRef.current);
    try {
      await sendMessage({
        channel: 'global',
        text,
        autoExecute: true,
      });
    } catch (err: any) {
      console.error('[assistant] send message failed', err);
    } finally {
      inFlightPromptsRef.current = Math.max(0, inFlightPromptsRef.current - 1);
      setInFlightPrompts(inFlightPromptsRef.current);
    }
  }, [sendMessage]);

  useEffect(() => {
    const availableSlots = Math.max(0, MAX_PARALLEL_GLOBAL_REQUESTS - inFlightPrompts);
    if (availableSlots <= 0 || queuedPrompts.length === 0) return;

    const batch = queuedPrompts.slice(0, availableSlots);
    if (batch.length === 0) return;

    setQueuedPrompts((prev) => prev.slice(batch.length));
    batch.forEach((text) => {
      void runPrompt(text);
    });
  }, [inFlightPrompts, queuedPrompts, runPrompt]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isCommandBusy) return;
    setInput('');
    try {
      if (text.startsWith('/')) {
        const handled = await handleSlashCommand(text);
        if (handled) return;
      }

      if (inFlightPromptsRef.current >= MAX_PARALLEL_GLOBAL_REQUESTS) {
        setQueuedPrompts((prev) => [...prev, text]);
        return;
      }

      void runPrompt(text);
    } catch (err: any) {
      console.error('[assistant] send message failed', err);
    }
  };

  const handleConfirm = async (messageId: string, approve: boolean, actionIds?: string[]) => {
    setConfirmLoadingMessageId(messageId);
    try {
      await confirmActions({
        channel: 'global',
        messageId,
        approve,
        actionIds,
      });
    } catch (err) {
      console.error('[assistant] confirm failed', err);
    } finally {
      setConfirmLoadingMessageId(null);
    }
  };

  const handleFabPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const baseLeft = rect.left - floatingOffset.x;
    const baseTop = rect.top - floatingOffset.y;
    const margin = 8;
    const minX = margin - baseLeft;
    const maxX = window.innerWidth - rect.width - margin - baseLeft;
    const minY = margin - baseTop;
    const maxY = window.innerHeight - rect.height - margin - baseTop;

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: floatingOffset.x,
      startOffsetY: floatingOffset.y,
      minX,
      maxX,
      minY,
      maxY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleFabPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const nextX = Math.min(drag.maxX, Math.max(drag.minX, drag.startOffsetX + dx));
    const nextY = Math.min(drag.maxY, Math.max(drag.minY, drag.startOffsetY + dy));

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
      suppressToggleRef.current = true;
    }

    setFloatingOffset({ x: nextX, y: nextY });
    event.preventDefault();
  };

  const handleFabPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    try {
      localStorage.setItem(FLOATING_CHAT_POSITION_KEY, JSON.stringify(floatingOffset));
    } catch {
      // noop
    }

    if (drag.moved) {
      window.setTimeout(() => {
        suppressToggleRef.current = false;
      }, 0);
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed bottom-6 right-6 z-[220]"
      style={{ transform: `translate(${floatingOffset.x}px, ${floatingOffset.y}px)` }}
    >
      {open && (
        <div className="w-[430px] max-w-[calc(100vw-2rem)] h-[560px] bg-[#061127] border border-indigo-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col">
          <div className="h-14 px-4 flex items-center justify-between bg-indigo-600/90 border-b border-indigo-500/50">
            <div>
              <div className="text-[12px] font-black tracking-widest uppercase text-white">Global Assistant</div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-indigo-100/90">
                {hasActiveGlobalWork ? 'Executing...' : 'Actionable mode'}
              </div>
            </div>
            <button
              type="button"
              className="w-8 h-8 rounded-lg bg-indigo-700/70 hover:bg-indigo-700 text-white transition-colors"
              onClick={() => setOpen(false)}
              title="Close"
            >
              <i className="fas fa-times text-[11px]"></i>
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-950/50">
            {visibleMessages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] rounded-2xl px-3 py-2 border text-[12px] ${
                  message.role === 'user'
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-900 border-white/10 text-slate-200'
                }`}>
                  <div className="whitespace-pre-wrap">{message.content}</div>
                  {message.actionPlan.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                      {message.actionPlan.map((action) => (
                        <div key={action.id} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="truncate text-slate-300">{action.actionType}</span>
                          <span className={`${getStatusTone(action.status)} uppercase tracking-widest font-black`}>
                            {statusLabel(action.status)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {message.pendingConfirmations.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleConfirm(
                          message.id,
                          true,
                          message.pendingConfirmations.map((item) => item.id)
                        )}
                        disabled={confirmLoadingMessageId === message.id}
                        className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirm(
                          message.id,
                          false,
                          message.pendingConfirmations.map((item) => item.id)
                        )}
                        disabled={confirmLoadingMessageId === message.id}
                        className="px-3 py-1.5 rounded-md bg-red-600 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-white/10 bg-slate-950">
            <div className="relative">
              <textarea
                className="w-full rounded-xl bg-[#020817] border border-indigo-500/40 text-slate-100 text-[12px] px-3 py-2 pr-12 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/70"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={isInputDisabled}
                rows={2}
                placeholder="Yêu cầu thao tác trên hệ thống... (gõ /help để xem lệnh)"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || isInputDisabled}
                className="absolute right-2 bottom-2 w-8 h-8 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
                title="Send"
              >
                <i className="fas fa-paper-plane text-[11px]"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onPointerDown={handleFabPointerDown}
        onPointerMove={handleFabPointerMove}
        onPointerUp={handleFabPointerUp}
        onPointerCancel={handleFabPointerUp}
        onClick={() => {
          if (suppressToggleRef.current) {
            suppressToggleRef.current = false;
            return;
          }
          setOpen((prev) => !prev);
        }}
        className={`ml-auto mt-3 w-14 h-14 rounded-full shadow-xl transition-all ${
          open ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white hover:scale-105'
        } touch-none cursor-grab active:cursor-grabbing`}
        title="Global Assistant"
      >
        <i className={`fas ${open ? 'fa-times' : 'fa-robot'} text-xl`}></i>
      </button>
    </div>
  );
};

export default GlobalAssistantChat;
