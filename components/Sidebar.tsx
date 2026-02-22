import React from 'react';
import { useLanguageStore } from '../store/languageStore';
import { useDataStore } from './bi/store/dataStore';
import { useThemeStore } from '../store/themeStore';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  hasConnections: boolean;
  onToggleCollapse?: () => void;
  currentUser: import('../types').User;
  width?: number; // Optional to preserve backward compatibility if needed, but we'll pass it
  onWidthChange?: (width: number) => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  restricted: boolean;
  hasNotification?: boolean;
  adminOnly?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onLogout,
  hasConnections,
  onToggleCollapse,
  currentUser,
  width = 256,
  onWidthChange
}) => {
  const { t, language, setLanguage } = useLanguageStore();
  const { theme, toggleTheme } = useThemeStore();
  const { systemLogs } = useDataStore();
  const displayName = String(currentUser?.name || currentUser?.email || 'Unknown User').trim();

  const hasErrorLogs = systemLogs.some(l => l.type === 'error');

  const menuItems: MenuItem[] = [
    { id: 'getting-started', label: t('nav.getting_started'), icon: 'fa-route', restricted: false },
    { id: 'connections', label: t('nav.connections'), icon: 'fa-link', restricted: false },
    { id: 'tables', label: t('nav.tables'), icon: 'fa-table', restricted: true },
    { id: 'reports', label: t('nav.reports'), icon: 'fa-chart-line', restricted: true },
    { id: 'data-modeling', label: t('nav.data_modeling'), icon: 'fa-diagram-project', restricted: true },
    { id: 'bi', label: t('nav.bi'), icon: 'fa-chart-pie', restricted: true },
    { id: 'ai-config', label: t('nav.ai_config'), icon: 'fa-robot', restricted: false },
    { id: 'logs', label: t('nav.logs'), icon: 'fa-terminal', restricted: false, hasNotification: hasErrorLogs },
    { id: 'users', label: t('nav.users'), icon: 'fa-user-group', restricted: false, adminOnly: true },
  ];

  const visibleMenuItems = menuItems.filter(item => !item.adminOnly || currentUser.role === 'Admin');
  const visibleMap = new Map(visibleMenuItems.map(item => [item.id, item]));
  const menuSections = [
    {
      id: 'setup',
      label: language === 'vi' ? 'Khởi tạo' : 'Setup',
      itemIds: ['getting-started', 'connections', 'tables'],
    },
    {
      id: 'analysis',
      label: language === 'vi' ? 'Phân tích' : 'Analysis',
      itemIds: ['bi', 'reports', 'data-modeling'],
    },
    {
      id: 'system',
      label: language === 'vi' ? 'Hệ thống' : 'System',
      itemIds: ['ai-config', 'logs', 'users'],
    },
  ]
    .map(section => ({
      ...section,
      items: section.itemIds
        .map((id) => visibleMap.get(id))
        .filter((item): item is MenuItem => Boolean(item)),
    }))
    .filter(section => section.items.length > 0);

  const isResizingRef = React.useRef(false);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;

    const startX = e.clientX;
    const startWidth = width;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (mvEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const currentX = mvEvent.clientX;
      const deltaX = currentX - startX;
      const newWidth = Math.max(200, Math.min(400, startWidth + deltaX));

      if (onWidthChange) {
        onWidthChange(newWidth);
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      style={{ width }}
      className="bg-white dark:bg-[#020617] text-slate-500 dark:text-slate-300 flex flex-col h-screen fixed left-0 top-0 border-r border-slate-200 dark:border-white/5 z-50 transition-colors duration-300 group"
    >
      {/* Resizer */}
      <div
        className="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-[100] transition-opacity
            bg-transparent hover:bg-indigo-500/50 dark:hover:bg-indigo-400/50"
        onMouseDown={startResizing}
      />
      {/* Visual Separator Line - Always Visible on Hover */}
      <div className="absolute top-0 right-0 w-[1px] h-full bg-slate-200 dark:bg-white/10 group-hover:bg-indigo-500 dark:group-hover:bg-indigo-400 transition-colors" />
      <div className="p-8 pb-4">
        <button
          type="button"
          className="w-full flex items-center gap-3 mb-4 text-left rounded-xl p-1 -m-1 hover:bg-slate-50/80 dark:hover:bg-white/[0.04] transition-colors"
          aria-label="Go to home"
          onClick={() => setActiveTab('getting-started')}
        >
          <div className="w-10 h-10 shrink-0 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <i className="fas fa-bolt text-white text-sm"></i>
          </div>
          <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tighter uppercase italic opacity-80 truncate">
            360data-solutions
          </h1>
        </button>
        <div className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">Current User</div>
          <div className="text-sm font-extrabold text-slate-800 dark:text-slate-200 truncate" title={displayName}>{displayName}</div>
        </div>
      </div>

      <nav className="flex-1 mt-2 px-4 overflow-y-auto custom-scrollbar">
        {menuSections.map((section, sectionIdx) => (
          <div
            key={section.id}
            className={`${sectionIdx === 0 ? '' : 'mt-4 pt-3 border-t border-slate-100 dark:border-white/5'}`}
          >
            <p className="px-2 mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              {section.label}
            </p>

            {section.items.map((item) => {
              const isLocked = item.restricted && !hasConnections;
              const hasNotification = item.hasNotification;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  disabled={isLocked}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all duration-200 relative group ${
                    isLocked
                      ? 'opacity-45 cursor-not-allowed grayscale'
                      : isActive
                        ? 'bg-gradient-to-r from-indigo-500/12 to-indigo-500/4 dark:from-indigo-500/15 dark:to-transparent text-slate-900 dark:text-indigo-100 border border-indigo-200/70 dark:border-indigo-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-none'
                        : 'text-slate-500 dark:text-slate-400 border border-transparent hover:bg-white/60 dark:hover:bg-white/[0.03] hover:border-slate-200/80 dark:hover:border-white/10 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-full bg-indigo-500" />
                  )}

                  <span
                    className={`w-[30px] h-[30px] shrink-0 rounded-lg flex items-center justify-center transition-colors ${
                      isActive
                        ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300'
                        : 'bg-transparent text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'
                    }`}
                  >
                    <i className={`fas ${item.icon} text-[14px]`}></i>
                  </span>

                  <span className="font-semibold tracking-tight text-[15px] leading-tight">{item.label}</span>

                  {isLocked ? (
                    <div className="ml-auto flex items-center justify-center w-[22px] h-[22px] bg-slate-100 dark:bg-slate-800 rounded-md group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition-colors">
                      <i className="fas fa-lock text-[9px] text-slate-400 dark:text-slate-500"></i>
                    </div>
                  ) : isActive ? (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.6)]"></div>
                  ) : hasNotification ? (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.75)]"></div>
                  ) : null}

                  {isLocked && (
                    <div className="absolute left-full ml-4 px-3 py-2 bg-slate-800 dark:bg-slate-900 border border-slate-700 dark:border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-2xl text-white">
                      {t('nav.locked_tooltip')}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-6 py-6 mb-4">
        <div className={`p-4 rounded-2xl border ${hasConnections ? 'bg-emerald-50 dark:bg-emerald-500/5 border-emerald-100 dark:border-emerald-500/20' : 'bg-amber-50 dark:bg-amber-500/5 border-amber-100 dark:border-amber-500/20'}`}>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-2 h-2 rounded-full ${hasConnections ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{t('sys.status')}</span>
          </div>
          <p className="text-[11px] font-medium text-slate-600 dark:text-slate-500 leading-tight">
            {hasConnections
              ? t('sys.active')
              : t('sys.pending')}
          </p>
        </div>
      </div>

      <div className="px-6 mb-4 flex gap-2">
        <button
          onClick={() => setLanguage(language === 'en' ? 'vi' : 'en')}
          className="flex-1 py-2 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-white/10 hover:text-indigo-600 dark:hover:text-white transition-all flex items-center justify-center gap-2"
        >
          <i className="fas fa-globe"></i>
          {language === 'en' ? t('lang.english') : t('lang.vietnamese')}
        </button>
        <button
          onClick={toggleTheme}
          className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-white/10 hover:text-indigo-600 dark:hover:text-yellow-400 transition-all"
          title={theme === 'dark' ? t('theme.switch_light') : t('theme.switch_dark')}
        >
          <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </div>

      <div className="p-6 border-t border-slate-100 dark:border-white/5 flex items-center justify-between">
        <button
          onClick={onLogout}
          className="flex-1 flex items-center gap-4 px-4 py-3 rounded-xl text-slate-500 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-all text-left"
        >
          <i className="fas fa-sign-out-alt w-5"></i>
          <span className="font-semibold">{t('nav.sign_out')}</span>
        </button>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="ml-2 p-3 rounded-xl text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-all"
            title={t('sidebar.hide')}
          >
            <i className="fas fa-angles-left"></i>
          </button>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
