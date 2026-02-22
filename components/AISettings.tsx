import React, { useEffect, useState } from 'react';
import { AI_MODELS } from '../constants';
import { testApiKey } from '../services/ai';
import { API_BASE } from '../services/api';
import { useLanguageStore } from '../store/languageStore';

type ToastType = 'success' | 'error';

interface ToastState {
  message: string;
  type: ToastType;
  id: number;
}

const AISettings: React.FC = () => {
  const { t } = useLanguageStore();
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('openai_api_key') || '');
  const [anthropicKey, setAnthropicKey] = useState(localStorage.getItem('anthropic_api_key') || '');
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = (message: string, type: ToastType = 'success') => {
    setToast({ message, type, id: Date.now() });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast?.id]);

  const saveAll = () => {
    localStorage.setItem('openai_api_key', openaiKey.trim());
    localStorage.setItem('anthropic_api_key', anthropicKey.trim());
    localStorage.setItem('gemini_api_key', geminiKey.trim());

    // Sync to Backend
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch(`${API_BASE}/ai-settings/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          settings: [
            { provider: 'gemini', apiKey: geminiKey.trim() },
            { provider: 'openai', apiKey: openaiKey.trim() },
            { provider: 'anthropic', apiKey: anthropicKey.trim() },
          ]
        })
      }).catch((error) => {
        console.error(error);
        showToast('Saved locally, but sync to server failed.', 'error');
      });
    }

    showToast(t('ai.saved'), 'success');
  };

  const handleTestKey = async (provider: string, key: string) => {
    setTesting(prev => ({ ...prev, [provider]: true }));
    const result = await testApiKey(provider, key);
    showToast(result.message, result.success ? 'success' : 'error');
    setTesting(prev => ({ ...prev, [provider]: false }));
  };

  const providers = [
    {
      id: 'Google',
      name: 'Google Gemini',
      icon: 'fa-brands fa-google text-blue-400',
      key: geminiKey,
      setKey: setGeminiKey,
      storageKey: 'gemini_api_key',
      placeholder: 'AIzaSy...',
      description: t('ai.provider.google_desc'),
      getKeyUrl: 'https://aistudio.google.com/app/apikey',
      color: 'blue'
    },
    {
      id: 'OpenAI',
      name: 'OpenAI (GPT)',
      icon: 'fas fa-brain text-emerald-500',
      key: openaiKey,
      setKey: setOpenaiKey,
      storageKey: 'openai_api_key',
      placeholder: 'sk-proj-...',
      description: t('ai.provider.openai_desc'),
      getKeyUrl: 'https://platform.openai.com/api-keys',
      color: 'emerald'
    },
    {
      id: 'Anthropic',
      name: 'Anthropic (Claude)',
      icon: 'fas fa-robot text-amber-500',
      key: anthropicKey,
      setKey: setAnthropicKey,
      storageKey: 'anthropic_api_key',
      placeholder: 'sk-ant-...',
      description: t('ai.provider.anthropic_desc'),
      getKeyUrl: 'https://console.anthropic.com/settings/keys',
      color: 'amber'
    }
  ];

  const toggleShowKey = (id: string) => {
    setShowKey(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-10 max-w-7xl mx-auto h-full overflow-y-auto custom-scrollbar">
      {toast && (
        <div className="fixed top-6 right-6 z-[80] animate-in fade-in slide-in-from-top-3 duration-300">
          <div className={`relative min-w-[320px] max-w-md rounded-[2rem] px-6 py-5 border backdrop-blur-2xl shadow-2xl flex items-start gap-4 ${toast.type === 'error' ? 'bg-rose-500/90 border-rose-200/40 text-white' : 'bg-indigo-600/90 border-indigo-200/30 text-white'}`}>
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${toast.type === 'error' ? 'bg-black/20 border-white/20' : 'bg-cyan-300/20 border-cyan-200/25'}`}>
              <i className={`fas ${toast.type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'} text-sm`}></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] opacity-80">
                {toast.type === 'error' ? 'Notification' : 'Saved'}
              </p>
              <p className="text-sm font-semibold leading-relaxed break-words">{toast.message}</p>
            </div>
            <button
              onClick={() => setToast(null)}
              className="w-8 h-8 rounded-xl bg-black/20 border border-white/20 hover:bg-black/30 transition-colors flex items-center justify-center"
              aria-label="Close notification"
            >
              <i className="fas fa-xmark text-xs"></i>
            </button>
          </div>
        </div>
      )}

      <div className="mb-16 flex justify-between items-end">
        <div>
          <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter mb-4 animate-in fade-in slide-in-from-left duration-700">{t('ai.neural_hub')}</h2>
          <p className="text-slate-400 font-medium text-lg max-w-2xl">
            {t('ai.subtitle')}
          </p>
        </div>
        <button
          onClick={saveAll}
          className="bg-indigo-600 text-white px-10 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all shadow-2xl shadow-indigo-600/30 active:scale-95 group"
        >
          <span className="flex items-center gap-3">
            <i className="fas fa-save group-hover:animate-bounce"></i>
            {t('ai.save_neural')}
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {providers.map((p, idx) => (
          <section key={p.id} className="animate-in fade-in slide-in-from-bottom duration-700" style={{ animationDelay: `${idx * 150}ms` }}>
            <div className="bg-white dark:bg-slate-900/40 backdrop-blur-2xl border border-slate-200 dark:border-white/5 rounded-[3.5rem] p-12 relative overflow-hidden group shadow-xl">
              {/* Background ambient light */}
              <div className={`absolute -right-20 -top-20 w-80 h-80 rounded-full blur-[100px] opacity-10 transition-opacity group-hover:opacity-20 ${p.id === 'Google' ? 'bg-blue-500' : p.id === 'OpenAI' ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>

              <div className="flex flex-col lg:flex-row gap-16 items-start relative z-10">
                {/* Provider Info & Key Input */}
                <div className="flex-1 space-y-8 w-full">
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 bg-slate-100 dark:bg-white/5 rounded-3xl flex items-center justify-center text-4xl shadow-inner border border-slate-200 dark:border-white/10 group-hover:scale-110 transition-transform duration-500">
                      <i className={p.icon}></i>
                    </div>
                    <div>
                      <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight mb-2">{p.name}</h3>
                      <p className="text-slate-500 font-bold text-sm uppercase tracking-widest">{p.description}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center px-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('ai.access_key')}</label>
                      <div className="flex items-center gap-4">
                        {p.key && (
                          <button
                            onClick={() => handleTestKey(p.id, p.key)}
                            disabled={testing[p.id]}
                            className="text-[9px] font-black text-indigo-400 uppercase tracking-widest hover:text-indigo-300 transition-colors bg-indigo-500/10 px-3 py-1 rounded-lg border border-indigo-500/20 disabled:opacity-50"
                          >
                            {testing[p.id] ? <i className="fas fa-circle-notch animate-spin mr-2"></i> : <i className="fas fa-vial mr-2"></i>}
                            {t('ai.test_connection')}
                          </button>
                        )}
                        {p.key && (
                          <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                            {t('ai.configured')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="relative group/input">
                      <input
                        type={showKey[p.id] ? 'text' : 'password'}
                        value={p.key}
                        onChange={(e) => p.setKey(e.target.value)}
                        placeholder={p.placeholder}
                        className={`w-full bg-slate-50 dark:bg-black/40 border-2 rounded-[1.5rem] px-8 py-5 text-slate-900 dark:text-white font-mono text-sm outline-none transition-all ${p.key ? 'border-indigo-500/30 focus:border-indigo-500' : 'border-slate-200 dark:border-white/5 focus:border-slate-300 dark:focus:border-white/20'}`}
                      />
                      <button
                        onClick={() => toggleShowKey(p.id)}
                        className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-2 transition-colors"
                      >
                        <i className={`fas ${showKey[p.id] ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                      </button>
                    </div>

                    {p.getKeyUrl && (
                      <div className="px-2 pt-2">
                        <a
                          href={p.getKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-3 px-6 py-3 rounded-2xl border transition-all duration-300 group/link ${p.id === 'Google' ? 'bg-blue-500/5 hover:bg-blue-500/10 border-blue-500/20 text-blue-400 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]' :
                            p.id === 'OpenAI' ? 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
                              'bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/20 text-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]'
                            }`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform group-hover/link:rotate-12 ${p.id === 'Google' ? 'bg-blue-500/20' :
                            p.id === 'OpenAI' ? 'bg-emerald-500/20' :
                              'bg-amber-500/20'
                            }`}>
                            <i className="fas fa-key text-xs"></i>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black uppercase tracking-[0.1em] opacity-60">{t('ai.no_key')}</span>
                            <span className="text-xs font-black tracking-tight flex items-center gap-2">
                              {t('ai.get_key', { name: p.name })}
                              <i className="fas fa-arrow-right text-[10px] group-hover/link:translate-x-1 transition-transform"></i>
                            </span>
                          </div>
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Vertical Divider */}
                <div className="hidden lg:block w-px h-64 bg-slate-100 dark:bg-white/5"></div>

                {/* Models List */}
                <div className="w-full lg:w-96">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6 px-2 text-center lg:text-left">{t('ai.available_engines')}</h4>
                  <div className="space-y-4">
                    {AI_MODELS.filter(m => m.provider === p.id).map(model => (
                      <div key={model.id} className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 hover:bg-slate-100 dark:hover:bg-white/10 hover:border-slate-200 dark:hover:border-white/10 transition-all cursor-default">
                        <div className="w-10 h-10 bg-white dark:bg-black/40 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-lg border border-slate-200 dark:border-white/5 shadow-sm">
                          <i className={model.icon}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-black text-slate-900 dark:text-white truncate">{model.name}</div>
                          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest truncate">{model.label}</div>
                        </div>
                        {model.isFree && (
                          <div className="px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-[8px] font-black text-indigo-400 uppercase">{t('ai.free')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      <div className="mt-20 text-center pb-20 opacity-50">
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.5em]">{t('ai.footer')}</p>
      </div>
    </div>
  );
};

export default AISettings;
