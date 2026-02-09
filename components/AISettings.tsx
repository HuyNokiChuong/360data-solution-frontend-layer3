import React, { useState } from 'react';
import { AI_MODELS } from '../constants';
import { testApiKey } from '../services/ai';

const AISettings: React.FC = () => {
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('openai_api_key') || '');
  const [anthropicKey, setAnthropicKey] = useState(localStorage.getItem('anthropic_api_key') || '');
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  const saveAll = () => {
    localStorage.setItem('openai_api_key', openaiKey.trim());
    localStorage.setItem('anthropic_api_key', anthropicKey.trim());
    localStorage.setItem('gemini_api_key', geminiKey.trim());
    alert('Đã lưu cấu hình API Key!');
  };

  const handleTestKey = async (provider: string, key: string) => {
    setTesting(prev => ({ ...prev, [provider]: true }));
    const result = await testApiKey(provider, key);
    alert(result.message);
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
      description: 'Tận hưởng sức mạnh của Gemini 2.0 Flash & Pro.',
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
      description: 'Dành cho các tác vụ cần độ chính xác cực cao với GPT-4o.',
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
      description: 'Sử dụng Claude 3.5 Sonnet cho khả năng lập trình đỉnh cao.',
      getKeyUrl: 'https://console.anthropic.com/settings/keys',
      color: 'amber'
    }
  ];

  const toggleShowKey = (id: string) => {
    setShowKey(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-10 max-w-7xl mx-auto h-full overflow-y-auto custom-scrollbar">
      <div className="mb-16 flex justify-between items-end">
        <div>
          <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter mb-4 animate-in fade-in slide-in-from-left duration-700">Neural Hub</h2>
          <p className="text-slate-400 font-medium text-lg max-w-2xl">
            Thiết lập chìa khóa kết nối với các "siêu trí tuệ" nhân tạo hàng đầu thế giới. Chỉ cần nhập Key và bắt đầu khám phá dữ liệu.
          </p>
        </div>
        <button
          onClick={saveAll}
          className="bg-indigo-600 text-white px-10 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all shadow-2xl shadow-indigo-600/30 active:scale-95 group"
        >
          <span className="flex items-center gap-3">
            <i className="fas fa-save group-hover:animate-bounce"></i>
            Lưu cấu hình Neural
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
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">API Access Key</label>
                      <div className="flex items-center gap-4">
                        {p.key && (
                          <button
                            onClick={() => handleTestKey(p.id, p.key)}
                            disabled={testing[p.id]}
                            className="text-[9px] font-black text-indigo-400 uppercase tracking-widest hover:text-indigo-300 transition-colors bg-indigo-500/10 px-3 py-1 rounded-lg border border-indigo-500/20 disabled:opacity-50"
                          >
                            {testing[p.id] ? <i className="fas fa-circle-notch animate-spin mr-2"></i> : <i className="fas fa-vial mr-2"></i>}
                            Test Connection
                          </button>
                        )}
                        {p.key && (
                          <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                            Đã cấu hình
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
                            <span className="text-[9px] font-black uppercase tracking-[0.1em] opacity-60">Bạn chưa có mã?</span>
                            <span className="text-xs font-black tracking-tight flex items-center gap-2">
                              Nhận ngay API Key {p.name}
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
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6 px-2 text-center lg:text-left">Available Engines</h4>
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
                          <div className="px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-[8px] font-black text-indigo-400 uppercase">Free</div>
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
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.5em]">360DATA NEURAL FABRIC • VERSION 2.0</p>
      </div>
    </div>
  );
};

export default AISettings;
