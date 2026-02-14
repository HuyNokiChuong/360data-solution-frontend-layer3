import React, { useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import { useLanguageStore } from '../store/languageStore';

interface GettingStartedGuideProps {
  currentUser: User;
  hasConnections: boolean;
  activeTableCount: number;
  onGoToTab: (tab: string) => void;
  onMarkComplete: () => void;
}

type StepState = 'done' | 'current' | 'locked';

interface MainStep {
  id: 1 | 2 | 3;
  titleEn: string;
  titleVi: string;
  pathEn: string;
  pathVi: string;
  taskEn: string;
  taskVi: string;
}

interface FlowProgress {
  viewedDataInfo: boolean;
  dashboardSetup: boolean;
  aiAsked: boolean;
}

const defaultProgress: FlowProgress = {
  viewedDataInfo: false,
  dashboardSetup: false,
  aiAsked: false,
};

const GettingStartedGuide: React.FC<GettingStartedGuideProps> = ({
  currentUser,
  hasConnections,
  activeTableCount,
  onGoToTab,
  onMarkComplete,
}) => {
  const { language } = useLanguageStore();
  const isVi = language === 'vi';
  const firstName = (currentUser.name || '').trim().split(' ')[0] || (isVi ? 'bạn' : 'there');

  const progressKey = useMemo(() => {
    const email = (currentUser.email || '').trim().toLowerCase();
    return `guide_flow_v3:${email || 'anonymous'}`;
  }, [currentUser.email]);

  const [progress, setProgress] = useState<FlowProgress>(defaultProgress);
  const [focusStepId, setFocusStepId] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(progressKey);
      if (!raw) {
        setProgress(defaultProgress);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<FlowProgress>;
      setProgress({
        viewedDataInfo: !!parsed.viewedDataInfo,
        dashboardSetup: !!parsed.dashboardSetup,
        aiAsked: !!parsed.aiAsked,
      });
    } catch {
      setProgress(defaultProgress);
    }
  }, [progressKey]);

  const updateProgress = (patch: Partial<FlowProgress>) => {
    setProgress((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(progressKey, JSON.stringify(next));
      return next;
    });
  };

  const step1Done = hasConnections;
  const step2Done = progress.viewedDataInfo || activeTableCount > 0;
  const step3Unlocked = step1Done && step2Done;
  const step3Done = progress.dashboardSetup && progress.aiAsked;

  const getStepState = (id: 1 | 2 | 3): StepState => {
    if (id === 1) return step1Done ? 'done' : 'current';
    if (id === 2) {
      if (!step1Done) return 'locked';
      return step2Done ? 'done' : 'current';
    }
    if (!step3Unlocked) return 'locked';
    return step3Done ? 'done' : 'current';
  };

  const nextRequiredStepId: 1 | 2 | 3 = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 3;

  useEffect(() => {
    setFocusStepId(nextRequiredStepId);
  }, [nextRequiredStepId]);

  const steps: MainStep[] = [
    {
      id: 1,
      titleEn: 'Step 1: Connect data source',
      titleVi: 'Bước 1: Kết nối nguồn dữ liệu',
      pathEn: 'Sidebar -> Connections -> New Pipeline',
      pathVi: 'Sidebar -> Kết nối -> Kết nối mới',
      taskEn: 'Create one connection and run first sync successfully.',
      taskVi: 'Tạo một kết nối và đồng bộ thành công lần đầu.',
    },
    {
      id: 2,
      titleEn: 'Step 2: View data information',
      titleVi: 'Bước 2: Xem thông tin dữ liệu',
      pathEn: 'Sidebar -> Data Assets',
      pathVi: 'Sidebar -> Tài sản dữ liệu',
      taskEn: 'Open Data Assets to review table schema and data status.',
      taskVi: 'Mở Tài sản dữ liệu để xem schema bảng và trạng thái dữ liệu.',
    },
    {
      id: 3,
      titleEn: 'Step 3: Analysis (2 actions)',
      titleVi: 'Bước 3: Phân tích (2 thao tác)',
      pathEn: 'Dashboard Studio first, then Ask AI',
      pathVi: 'Thiết kế Dashboard trước, sau đó Hỏi đáp AI',
      taskEn: 'Set up dashboard (highlight) and then ask AI for insight.',
      taskVi: 'Set up dashboard (ưu tiên) rồi hỏi AI để lấy insight.',
    },
  ];

  const focusStep = steps.find((step) => step.id === focusStepId) || steps[0];
  const focusState = getStepState(focusStep.id);
  const setupProgress = Math.round(
    ((Number(step1Done) + Number(step2Done) + Number(step3Done)) / 3) * 100
  );
  const progressAngle = Math.round(setupProgress * 3.6);

  const stateLabel = (state: StepState) => {
    if (state === 'done') return isVi ? 'ĐÃ XONG' : 'DONE';
    if (state === 'current') return isVi ? 'LÀM NGAY' : 'DO NOW';
    return isVi ? 'KHÓA' : 'LOCKED';
  };

  const stateClass = (state: StepState) => {
    if (state === 'done') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300';
    if (state === 'current') return 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300';
    return 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  };

  const navigateWithMark = (tab: 'connections' | 'tables' | 'bi' | 'reports', state: StepState, mark?: Partial<FlowProgress>) => {
    if (state === 'locked') return;
    if (mark) updateProgress(mark);
    onMarkComplete();
    onGoToTab(tab);
  };

  const dashboardState: StepState = !step3Unlocked
    ? 'locked'
    : progress.dashboardSetup
      ? 'done'
      : 'current';

  const aiState: StepState = !step3Unlocked || !progress.dashboardSetup
    ? 'locked'
    : progress.aiAsked
      ? 'done'
      : 'current';

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-8">
      <div className="max-w-7xl mx-auto pb-8 space-y-5">
        <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl shadow-slate-200/60 dark:shadow-black/50 guide2-enter">
          <div className="absolute -top-20 -left-20 w-80 h-80 bg-teal-500/20 blur-3xl rounded-full guide2-ambient"></div>
          <div className="absolute -bottom-24 -right-20 w-80 h-80 bg-amber-500/20 blur-3xl rounded-full guide2-ambient"></div>
          <div className="absolute inset-0 guide2-grid opacity-40"></div>

          <div className="relative z-10 grid grid-cols-1 xl:grid-cols-12 gap-5 p-5 md:p-7">
            <div className="xl:col-span-8 guide2-enter" style={{ animationDelay: '80ms' }}>
              <p className="text-[11px] uppercase tracking-[0.24em] font-black text-teal-700 dark:text-teal-300 mb-2">
                {isVi ? 'FLOW NEWBIE 3 BƯỚC' : '3-STEP NEWBIE FLOW'}
              </p>
              <h1 className="text-3xl md:text-5xl font-black leading-[1.05] text-slate-900 dark:text-white max-w-4xl">
                {isVi
                  ? `${firstName}, đi theo đúng 3 bước này là chạy hệ thống được ngay`
                  : `${firstName}, follow these exact 3 steps to use the system immediately`}
              </h1>
              <p className="mt-3 text-sm md:text-base text-slate-600 dark:text-slate-300 max-w-3xl">
                {isVi
                  ? 'Step 3 bao gồm 2 thao tác, trong đó Setup Dashboard là bước được ưu tiên highlight.'
                  : 'Step 3 includes 2 actions, with Dashboard Setup as the highlighted priority.'}
              </p>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  onClick={() => navigateWithMark('connections', 'current')}
                  className="rounded-xl px-4 py-3 text-left border border-teal-200 dark:border-teal-400/30 bg-teal-50 dark:bg-teal-500/10 hover:bg-teal-100 dark:hover:bg-teal-500/20 transition-all"
                >
                  <p className="text-[10px] uppercase tracking-[0.16em] font-black text-teal-700 dark:text-teal-300 mb-1">
                    {isVi ? 'Hành động nhanh 1' : 'Quick Action 1'}
                  </p>
                  <p className="text-sm font-black text-slate-900 dark:text-white">
                    {isVi ? 'Mở Kết nối dữ liệu' : 'Open Data Connection'}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    {isVi ? 'Bước 1' : 'Step 1'}
                  </p>
                </button>

                <button
                  onClick={() => navigateWithMark('tables', step1Done ? 'current' : 'locked', { viewedDataInfo: true })}
                  disabled={!step1Done}
                  className={`rounded-xl px-4 py-3 text-left border transition-all ${
                    step1Done
                      ? 'border-sky-200 dark:border-sky-400/30 bg-sky-50 dark:bg-sky-500/10 hover:bg-sky-100 dark:hover:bg-sky-500/20'
                      : 'border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-[0.16em] font-black text-sky-700 dark:text-sky-300 mb-1">
                    {isVi ? 'Hành động nhanh 2' : 'Quick Action 2'}
                  </p>
                  <p className="text-sm font-black text-slate-900 dark:text-white">
                    {isVi ? 'Xem thông tin dữ liệu' : 'View Data Info'}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    {isVi ? 'Bước 2' : 'Step 2'}
                  </p>
                </button>

                <button
                  onClick={() => navigateWithMark('bi', step3Unlocked ? 'current' : 'locked', { dashboardSetup: true })}
                  disabled={!step3Unlocked}
                  className={`rounded-xl px-4 py-3 text-left border transition-all ${
                    step3Unlocked
                      ? 'border-amber-200 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 guide2-highlight-card'
                      : 'border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-[0.16em] font-black text-amber-700 dark:text-amber-300 mb-1">
                    {isVi ? 'Hành động nhanh 3' : 'Quick Action 3'}
                  </p>
                  <p className="text-sm font-black text-slate-900 dark:text-white">
                    {isVi ? 'Set up Dashboard (Highlight)' : 'Set up Dashboard (Highlight)'}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    {isVi ? 'Bước 3' : 'Step 3'}
                  </p>
                </button>
              </div>
            </div>

            <aside className="xl:col-span-4 guide2-enter" style={{ animationDelay: '140ms' }}>
              <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/60 p-4">
                <div className="flex items-center gap-4">
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center text-xs font-black text-slate-900 dark:text-white guide2-progress-ring"
                    style={{ background: `conic-gradient(#0d9488 ${progressAngle}deg, rgba(148, 163, 184, 0.35) ${progressAngle}deg)` }}
                  >
                    <div className="w-14 h-14 rounded-full bg-white dark:bg-slate-900 flex items-center justify-center">
                      {setupProgress}%
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 dark:text-slate-400">
                      {isVi ? 'FLOW PROGRESS' : 'FLOW PROGRESS'}
                    </p>
                    <p className="text-lg font-black text-slate-900 dark:text-white">
                      {isVi ? 'Tiến độ onboarding' : 'Onboarding progress'}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {isVi ? 'Hoàn thành đủ 3 bước để kết thúc flow' : 'Complete all 3 steps to finish flow'}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-7 rounded-[1.6rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 md:p-5 guide2-enter" style={{ animationDelay: '200ms' }}>
            <div className="mb-3">
              <p className="text-[11px] uppercase tracking-[0.2em] font-black text-slate-500 dark:text-slate-400">
                {isVi ? 'LUỒNG CHÍNH' : 'MAIN FLOW'}
              </p>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white">
                {isVi ? 'Bước 1 -> Bước 2 -> Bước 3' : 'Step 1 -> Step 2 -> Step 3'}
              </h2>
            </div>

            <div className="space-y-3">
              {steps.map((step, index) => {
                const stepState = getStepState(step.id);
                const isFocused = step.id === focusStep.id;
                const isConnectorDone = index < focusStep.id - 1;

                return (
                  <div key={step.id} className="relative">
                    <button
                      onClick={() => {
                        setFocusStepId(step.id);
                      }}
                      className={`w-full text-left rounded-2xl border px-4 py-4 md:px-5 md:py-5 transition-all ${
                        isFocused
                          ? 'border-teal-300 dark:border-teal-400/40 bg-teal-50 dark:bg-teal-500/10 guide2-step-focused'
                          : 'border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-slate-800/40 hover:border-teal-200 dark:hover:border-teal-500/40'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className={`h-11 w-11 rounded-xl flex items-center justify-center text-sm font-black ${
                            isFocused
                              ? 'bg-teal-600 text-white'
                              : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                          }`}>
                            {step.id}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-base md:text-lg font-black text-slate-900 dark:text-white">
                                {isVi ? step.titleVi : step.titleEn}
                              </h3>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest ${stateClass(stepState)}`}>
                                {stateLabel(stepState)}
                              </span>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-300">{isVi ? step.taskVi : step.taskEn}</p>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-300 font-bold">
                          {isVi ? step.pathVi : step.pathEn}
                        </div>
                      </div>
                    </button>

                    {index < steps.length - 1 && (
                      <div className={`ml-5 md:ml-6 h-4 border-l-2 ${
                        isConnectorDone ? 'guide2-connector' : 'border-slate-200 dark:border-slate-700'
                      }`}></div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="xl:col-span-5 rounded-[1.6rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 md:p-5 guide2-enter" style={{ animationDelay: '260ms' }}>
            <p className="text-[11px] uppercase tracking-[0.2em] font-black text-teal-700 dark:text-teal-300 mb-2">
              {isVi ? 'CHI TIẾT BƯỚC ĐANG FOCUS' : 'FOCUSED STEP DETAIL'}
            </p>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white">
              {isVi ? focusStep.titleVi : focusStep.titleEn}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {isVi ? focusStep.taskVi : focusStep.taskEn}
            </p>

            <div className="mt-4 rounded-xl border border-teal-200 dark:border-teal-400/30 bg-teal-50/70 dark:bg-teal-500/10 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] font-black text-teal-700 dark:text-teal-300 mb-1">
                {isVi ? 'CLICK PATH' : 'CLICK PATH'}
              </p>
              <code className="text-xs md:text-sm font-bold text-teal-700 dark:text-teal-300">
                {isVi ? focusStep.pathVi : focusStep.pathEn}
              </code>
            </div>

            {focusStep.id !== 3 ? (
              <button
                onClick={() => {
                  if (focusStep.id === 1) {
                    navigateWithMark('connections', focusState);
                    return;
                  }
                  navigateWithMark('tables', focusState, { viewedDataInfo: true });
                }}
                disabled={focusState === 'locked'}
                className={`mt-4 w-full px-4 py-3 rounded-xl text-sm font-black transition-all ${
                  focusState === 'locked'
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                    : 'bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/25'
                }`}
              >
                {focusStep.id === 1
                  ? (isVi ? 'Mở màn Kết nối' : 'Open Connections')
                  : (isVi ? 'Mở Tài sản dữ liệu' : 'Open Data Assets')}
              </button>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-amber-300/70 dark:border-amber-400/40 bg-gradient-to-r from-amber-50 to-teal-50 dark:from-amber-500/15 dark:to-teal-500/10 p-3 guide2-highlight-card">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-black text-slate-900 dark:text-white">
                      {isVi ? 'Set up dashboard (Highlight)' : 'Set up dashboard (Highlight)'}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest ${stateClass(dashboardState)}`}>
                      {stateLabel(dashboardState)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-200 mb-2">
                    {isVi ? 'Sidebar -> Thiết kế Dashboard' : 'Sidebar -> Dashboard Studio'}
                  </p>
                  <button
                    onClick={() => navigateWithMark('bi', dashboardState, { dashboardSetup: true })}
                    disabled={dashboardState === 'locked'}
                    className={`w-full px-3 py-2 rounded-lg text-sm font-black transition-all ${
                      dashboardState === 'locked'
                        ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                        : 'bg-amber-500 hover:bg-amber-400 text-slate-900 shadow-lg shadow-amber-500/25'
                    }`}
                  >
                    {isVi ? 'Mở Dashboard Studio' : 'Open Dashboard Studio'}
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-black text-slate-900 dark:text-white">
                      {isVi ? 'Hỏi đáp AI' : 'Ask AI'}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest ${stateClass(aiState)}`}>
                      {stateLabel(aiState)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-200 mb-2">
                    {isVi ? 'Sidebar -> Hỏi đáp AI' : 'Sidebar -> Ask AI'}
                  </p>
                  <button
                    onClick={() => navigateWithMark('reports', aiState, { aiAsked: true })}
                    disabled={aiState === 'locked'}
                    className={`w-full px-3 py-2 rounded-lg text-sm font-black transition-all ${
                      aiState === 'locked'
                        ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                        : 'bg-teal-600 hover:bg-teal-500 text-white'
                    }`}
                  >
                    {isVi ? 'Mở Hỏi đáp AI' : 'Open Ask AI'}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </section>
      </div>
    </div>
  );
};

export default GettingStartedGuide;
