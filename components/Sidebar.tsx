
import React from 'react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  hasConnections: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onLogout, hasConnections }) => {
  const menuItems = [
    { id: 'connections', label: 'Connections', icon: 'fa-link', restricted: false },
    { id: 'tables', label: 'Tables', icon: 'fa-table', restricted: true },
    { id: 'reports', label: 'Report Builder', icon: 'fa-chart-line', restricted: true },
    { id: 'ai-config', label: 'AI Settings', icon: 'fa-robot', restricted: false },
    { id: 'users', label: 'Users', icon: 'fa-user-group', restricted: true },
  ];

  return (
    <div className="w-64 bg-[#020617] text-slate-300 flex flex-col h-screen fixed left-0 top-0 border-r border-white/5">
      <div className="p-8">
        <h1 className="text-xl font-bold flex items-center gap-3 text-white">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <i className="fas fa-bolt text-white"></i>
          </div>
          <span className="tracking-tight">360data-solutions</span>
        </h1>
      </div>
      
      <nav className="flex-1 mt-4 px-4">
        {menuItems.map((item) => {
          const isLocked = item.restricted && !hasConnections;
          
          return (
            <button
              key={item.id}
              disabled={isLocked}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl mb-2 transition-all duration-200 relative group ${
                isLocked 
                  ? 'opacity-40 cursor-not-allowed grayscale' 
                  : activeTab === item.id 
                    ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' 
                    : 'text-slate-500 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <i className={`fas ${item.icon} w-5 text-lg`}></i>
              <span className="font-semibold">{item.label}</span>
              
              {isLocked ? (
                <div className="ml-auto flex items-center justify-center w-6 h-6 bg-slate-800 rounded-lg group-hover:bg-slate-700 transition-colors">
                  <i className="fas fa-lock text-[10px] text-slate-500"></i>
                </div>
              ) : activeTab === item.id && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]"></div>
              )}

              {/* Tooltip for locked items */}
              {isLocked && (
                <div className="absolute left-full ml-4 px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-2xl">
                  Add a connection first
                </div>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-6 py-6 mb-4">
         <div className={`p-4 rounded-2xl border ${hasConnections ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
            <div className="flex items-center gap-3 mb-2">
               <div className={`w-2 h-2 rounded-full ${hasConnections ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></div>
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">System Status</span>
            </div>
            <p className="text-[11px] font-medium text-slate-500 leading-tight">
               {hasConnections 
                 ? 'Pipeline established. AI analysis active.' 
                 : 'Neural link pending. Connect your data warehouse.'}
            </p>
         </div>
      </div>

      <div className="p-6 border-t border-white/5">
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all"
        >
          <i className="fas fa-sign-out-alt w-5"></i>
          <span className="font-semibold">Sign Out</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
