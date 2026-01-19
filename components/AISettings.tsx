
import React, { useState, useEffect } from 'react';
import { AI_MODELS } from '../constants';

interface CustomModel {
  id: string;
  provider: 'Google' | 'OpenAI';
  name: string;
  label: string;
  description: string;
  icon: string;
  brandIcon: string;
  isFree: boolean;
  temperature: number;
}

const AISettings: React.FC = () => {
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('openai_api_key') || '');
  const [showKey, setShowKey] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Load custom models from localStorage or empty array
  const [customModels, setCustomModels] = useState<CustomModel[]>(() => {
    const saved = localStorage.getItem('custom_ai_models');
    return saved ? JSON.parse(saved) : [];
  });

  const [newModel, setNewModel] = useState<Partial<CustomModel>>({
    provider: 'Google',
    name: '',
    id: '',
    label: 'Custom',
    description: '',
    temperature: 0.7,
    isFree: true
  });

  const allModels = [...AI_MODELS, ...customModels];

  const saveAll = () => {
    localStorage.setItem('openai_api_key', openaiKey);
    localStorage.setItem('custom_ai_models', JSON.stringify(customModels));
    alert('Đã lưu tất cả cấu hình neural!');
  };

  const addModel = () => {
    if (!newModel.name || !newModel.id) return;
    
    const modelToAdd: CustomModel = {
      ...newModel as CustomModel,
      icon: newModel.provider === 'Google' ? 'fa-solid fa-microchip' : 'fa-solid fa-sparkles',
      brandIcon: newModel.provider === 'Google' ? 'fa-brands fa-google text-blue-400' : 'fa-brands fa-openai text-emerald-500',
      isFree: newModel.provider === 'Google'
    };

    const updated = [...customModels, modelToAdd];
    setCustomModels(updated);
    localStorage.setItem('custom_ai_models', JSON.stringify(updated));
    setIsModalOpen(false);
    setNewModel({ provider: 'Google', name: '', id: '', label: 'Custom', description: '', temperature: 0.7, isFree: true });
  };

  const deleteCustomModel = (id: string) => {
    const updated = customModels.filter(m => m.id !== id);
    setCustomModels(updated);
    localStorage.setItem('custom_ai_models', JSON.stringify(updated));
  };

  const providers = ['Google', 'OpenAI'];

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <div className="mb-12 flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter mb-2">Neural Hub</h2>
          <p className="text-slate-500 font-medium">Quản lý và thiết lập các Engine trí tuệ nhân tạo</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-white/5 text-white border border-white/10 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-3"
          >
            <i className="fas fa-plus"></i> Add Engine
          </button>
          <button 
            onClick={saveAll}
            className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20"
          >
            Lưu tất cả cấu hình
          </button>
        </div>
      </div>

      <div className="space-y-16">
        {providers.map(provider => (
          <section key={provider}>
            <div className="flex items-center gap-4 mb-8">
              <i className={`${provider === 'Google' ? 'fa-brands fa-google text-blue-400' : 'fa-brands fa-openai text-emerald-500'} text-2xl`}></i>
              <h3 className="text-2xl font-black text-white tracking-tight uppercase">{provider} Engines</h3>
              <div className="flex-1 h-px bg-white/5 ml-4"></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {allModels.filter(m => m.provider === provider).map(model => (
                <div key={model.id} className={`bg-slate-900/40 backdrop-blur-md p-8 rounded-[2.5rem] border transition-all group relative ${(!model.isFree && !openaiKey) ? 'border-red-500/30' : 'border-white/5 hover:border-indigo-500/20'}`}>
                  
                  {/* Delete button for custom models */}
                  {customModels.some(cm => cm.id === model.id) && (
                    <button 
                      onClick={() => deleteCustomModel(model.id)}
                      className="absolute top-6 right-6 w-8 h-8 bg-red-500/10 text-red-500 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                    >
                      <i className="fas fa-trash-alt text-[10px]"></i>
                    </button>
                  )}

                  <div className="flex justify-between items-start mb-8">
                    <div className="flex gap-4">
                      <div className="w-14 h-14 bg-white/5 text-indigo-400 rounded-2xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-inner border border-white/5">
                        <i className={model.icon}></i>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white tracking-tight">{model.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-black uppercase tracking-widest ${model.isFree ? 'text-indigo-500' : (openaiKey ? 'text-emerald-500' : 'text-red-500')}`}>
                            {model.isFree ? 'Miễn phí' : (openaiKey ? 'Đã kích hoạt' : 'Cần Key')}
                          </span>
                          <div className="w-1 h-1 rounded-full bg-slate-700"></div>
                          <span className="text-[10px] font-black uppercase text-slate-600 tracking-widest">{model.id}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="text-slate-400 text-sm mb-8 leading-relaxed font-medium">{(model as any).description || 'Engine phân tích dữ liệu tùy chỉnh.'}</p>

                  <div className="space-y-6">
                    {!model.isFree && model.provider === 'OpenAI' && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">OpenAI API Key (Shared)</label>
                        <div className="relative">
                          <input 
                            type={showKey ? 'text' : 'password'}
                            value={openaiKey}
                            onChange={(e) => setOpenaiKey(e.target.value)}
                            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                            className={`w-full bg-black/40 border rounded-xl px-4 py-3 text-white text-xs outline-none transition-all ${openaiKey ? 'border-emerald-500/20 focus:border-emerald-500/50' : 'border-red-500/20'}`}
                          />
                          <button 
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                          >
                            <i className={`fas ${showKey ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex justify-between mb-3">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Temperature (Creativity)</label>
                        <span className="text-xs font-black text-indigo-400">{(model as any).temperature}</span>
                      </div>
                      <input 
                        type="range" min="0" max="1" step="0.1" 
                        value={(model as any).temperature} 
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        disabled // Static for now in list view
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Add Model Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="w-full max-w-xl bg-[#0f172a] border border-white/10 rounded-[3rem] shadow-3xl overflow-hidden p-12 animate-in zoom-in-95">
             <div className="flex justify-between items-center mb-10">
                <div>
                  <h2 className="text-3xl font-black text-white tracking-tight">Add AI Engine</h2>
                  <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mt-1">Configure new neural link</p>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="w-12 h-12 bg-white/5 rounded-full text-slate-500 hover:text-white transition-all">
                  <i className="fas fa-times"></i>
                </button>
             </div>

             <div className="space-y-8">
                <div className="grid grid-cols-2 gap-4 p-1 bg-black/30 rounded-2xl border border-white/5">
                  {['Google', 'OpenAI'].map(p => (
                    <button 
                      key={p}
                      onClick={() => setNewModel({...newModel, provider: p as any, isFree: p === 'Google'})}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${newModel.provider === p ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">Engine Name</label>
                  <input 
                    value={newModel.name}
                    onChange={e => setNewModel({...newModel, name: e.target.value})}
                    placeholder="e.g. Gemini 2.5 Flash Latest"
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">Model ID (Exact)</label>
                  <input 
                    value={newModel.id}
                    onChange={e => setNewModel({...newModel, id: e.target.value})}
                    placeholder="gemini-2.5-flash-lite-latest"
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">Label</label>
                  <input 
                    value={newModel.label}
                    onChange={e => setNewModel({...newModel, label: e.target.value})}
                    placeholder="Experimental"
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-800"
                  />
                </div>
             </div>

             <div className="flex gap-4 mt-12">
               <button onClick={() => setIsModalOpen(false)} className="flex-1 py-5 text-[10px] font-black uppercase tracking-widest text-slate-500">Cancel</button>
               <button 
                onClick={addModel}
                disabled={!newModel.name || !newModel.id}
                className="flex-[2] bg-indigo-600 text-white py-5 rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-500 shadow-2xl shadow-indigo-600/30 transition-all disabled:opacity-50"
               >
                 Register Engine
               </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AISettings;
