
import React from 'react';
import { useLanguageStore } from '../store/languageStore';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  hasConnections: boolean;
  onToggleCollapse?: () => void;
  currentUser: import('../types').User;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onLogout, hasConnections, onToggleCollapse, currentUser }) => {
  const { t } = useLanguageStore();

  const menuItems = [
    { id: 'connections', label: t('nav.connections'), icon: 'fa-link', restricted: false },
    { id: 'tables', label: t('nav.tables'), icon: 'fa-table', restricted: true },
    { id: 'reports', label: t('nav.reports'), icon: 'fa-chart-line', restricted: true },
    { id: 'bi', label: t('nav.bi'), icon: 'fa-chart-pie', restricted: true },
    { id: 'ai-config', label: t('nav.ai_config'), icon: 'fa-robot', restricted: false },
    { id: 'users', label: t('nav.users'), icon: 'fa-user-group', restricted: false, adminOnly: true },
  ];

  const visibleMenuItems = menuItems.filter(item => !item.adminOnly || currentUser.role === 'Admin');

  return (
    <div className="w-64 bg-[#020617] text-slate-300 flex flex-col h-screen fixed left-0 top-0 border-r border-white/5 z-50">
      <div className="p-8 pb-4">
        <div className="flex items-center justify-between mb-6">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <i className="fas fa-bolt text-white"></i>
          </div>
        </div>
        <h1 className="text-lg font-black text-white tracking-tighter uppercase italic opacity-80">
          360data-solutions
        </h1>
      </div>

      <nav className="flex-1 mt-4 px-4">
        {visibleMenuItems.map((item) => {
          const isLocked = item.restricted && !hasConnections;

          return (
            <button
              key={item.id}
              disabled={isLocked}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl mb-2 transition-all duration-200 relative group ${isLocked
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
                  {t('nav.locked_tooltip')}
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
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('sys.status')}</span>
          </div>
          <p className="text-[11px] font-medium text-slate-500 leading-tight">
            {hasConnections
              ? t('sys.active')
              : t('sys.pending')}
          </p>
        </div>
      </div>

      <div className="p-6 border-t border-white/5 flex items-center justify-between">
        <button
          onClick={onLogout}
          className="flex-1 flex items-center gap-4 px-4 py-3 rounded-xl text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all text-left"
        >
          <i className="fas fa-sign-out-alt w-5"></i>
          <span className="font-semibold">{t('nav.sign_out')}</span>
        </button>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="ml-2 p-3 rounded-xl text-slate-500 hover:bg-white/5 hover:text-white transition-all"
            title="Hide Sidebar"
          >
            <i className="fas fa-angles-left"></i>
          </button>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
