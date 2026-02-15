import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantRuntime } from './AssistantRuntimeProvider';
import type { AssistantMessage } from './types';

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const isChatBusy = isBusyGlobal || isCommandBusy;

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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isChatBusy) return;
    setInput('');
    try {
      if (text.startsWith('/')) {
        const handled = await handleSlashCommand(text);
        if (handled) return;
      }

      await sendMessage({
        channel: 'global',
        text,
        autoExecute: true,
      });
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

  return (
    <div className="fixed bottom-6 right-6 z-[220]">
      {open && (
        <div className="w-[380px] max-w-[calc(100vw-2rem)] h-[560px] bg-[#061127] border border-indigo-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col">
          <div className="h-14 px-4 flex items-center justify-between bg-indigo-600/90 border-b border-indigo-500/50">
            <div>
              <div className="text-[12px] font-black tracking-widest uppercase text-white">Global Assistant</div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-indigo-100/90">
                {isBusyGlobal ? 'Executing...' : 'Actionable mode'}
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
                disabled={!input.trim() || isChatBusy}
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
        onClick={() => setOpen((prev) => !prev)}
        className={`ml-auto mt-3 w-14 h-14 rounded-full shadow-xl transition-all ${
          open ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white hover:scale-105'
        }`}
        title="Global Assistant"
      >
        <i className={`fas ${open ? 'fa-times' : 'fa-robot'} text-xl`}></i>
      </button>
    </div>
  );
};

export default GlobalAssistantChat;
