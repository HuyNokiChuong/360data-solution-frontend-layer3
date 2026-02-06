
import React, { useState } from 'react';
import { AI_MODELS } from '../constants';

const AISettings: React.FC = () => {
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('openai_api_key') || '');
  const [anthropicKey, setAnthropicKey] = useState(localStorage.getItem('anthropic_api_key') || '');
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const saveAll = () => {
    localStorage.setItem('openai_api_key', openaiKey);
    localStorage.setItem('anthropic_api_key', anthropicKey);
    localStorage.setItem('gemini_api_key', geminiKey);
    alert('Đã lưu cấu hình API Key!');
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
      description: 'Tận hưởng sức mạnh của Gemini 2.0 Flash & Pro.'
    },
    {
      id: 'OpenAI',
      name: 'OpenAI (GPT)',
      icon: 'fa-brands fa-openai text-emerald-500',
      key: openaiKey,
      setKey: setOpenaiKey,
      storageKey: 'openai_api_key',
      placeholder: 'sk-proj-...',
      description: 'Dành cho các tác vụ cần độ chính xác cực cao với GPT-4o.'
    },
    {
      id: 'Anthropic',
      name: 'Anthropic (Claude)',
      icon: 'fas fa-robot text-amber-500',
      key: anthropicKey,
      setKey: setAnthropicKey,
      storageKey: 'anthropic_api_key',
      placeholder: 'sk-ant-...',
      description: 'Sử dụng Claude 3.5 Sonnet cho khả năng lập trình đỉnh cao.'
    }
  ];

  const toggleShowKey = (id: string) => {
    setShowKey(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-10 max-w-7xl mx-auto h-full overflow-y-auto custom-scrollbar">
      <div className="mb-16 flex justify-between items-end">
        <div>
          <h2 className="text-5xl font-black text-white tracking-tighter mb-4 animate-in fade-in slide-in-from-left duration-700">Neural Hub</h2>
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
            <div className="bg-slate-900/40 backdrop-blur-2xl border border-white/5 rounded-[3.5rem] p-12 relative overflow-hidden group">
              {/* Background ambient light */}
              <div className={`absolute -right-20 -top-20 w-80 h-80 rounded-full blur-[100px] opacity-10 transition-opacity group-hover:opacity-20 ${p.id === 'Google' ? 'bg-blue-500' : p.id === 'OpenAI' ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>

              <div className="flex flex-col lg:flex-row gap-16 items-start relative z-10">
                {/* Provider Info & Key Input */}
                <div className="flex-1 space-y-8 w-full">
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center text-4xl shadow-inner border border-white/10 group-hover:scale-110 transition-transform duration-500">
                      <i className={p.icon}></i>
                    </div>
                    <div>
                      <h3 className="text-3xl font-black text-white tracking-tight mb-2">{p.name}</h3>
                      <p className="text-slate-500 font-bold text-sm uppercase tracking-widest">{p.description}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center px-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">API Access Key</label>
                      {p.key && (
                        <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                          Đã cấu hình
                        </span>
                      )}
                    </div>
                    <div className="relative group/input">
                      <input
                        type={showKey[p.id] ? 'text' : 'password'}
                        value={p.key}
                        onChange={(e) => p.setKey(e.target.value)}
                        placeholder={p.placeholder}
                        className={`w-full bg-black/40 border-2 rounded-[1.5rem] px-8 py-5 text-white font-mono text-sm outline-none transition-all ${p.key ? 'border-indigo-500/30 focus:border-indigo-500' : 'border-white/5 focus:border-white/20'}`}
                      />
                      <button
                        onClick={() => toggleShowKey(p.id)}
                        className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-2 transition-colors"
                      >
                        <i className={`fas ${showKey[p.id] ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Vertical Divider */}
                <div className="hidden lg:block w-px h-64 bg-gradient-to-b from-transparent via-white/5 to-transparent"></div>

                {/* Models List */}
                <div className="w-full lg:w-96">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6 px-2 text-center lg:text-left">Available Engines</h4>
                  <div className="space-y-4">
                    {AI_MODELS.filter(m => m.provider === p.id).map(model => (
                      <div key={model.id} className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all cursor-default">
                        <div className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center text-indigo-400 text-lg">
                          <i className={model.icon}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-black text-white truncate">{model.name}</div>
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
