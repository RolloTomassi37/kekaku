'use client';

import {
  Calendar1,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Clock3,
  Inbox,
  LayoutGrid,
  LoaderCircle,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';

type ViewMode = 'month' | 'week' | 'day';
type Category = 'work' | 'study' | 'health' | 'life' | 'other';
type Section = 'calendar' | 'inbox' | 'completed';
type Source = 'manual' | 'ai' | 'quick';

type Plan = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  category: Category;
  note: string;
  completed: boolean;
  source: Source;
};

type PlanDraft = Omit<Plan, 'id' | 'completed' | 'source'>;

type AiPreview = {
  summary: string;
  plans: PlanDraft[];
  source: 'ai' | 'quick';
};

const STORAGE_KEY = 'kekaku-plans-v1';
const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const monthWeekdays = ['一', '二', '三', '四', '五', '六', '日'];
const timelineHours = Array.from({ length: 13 }, (_, index) => index + 8);

const categoryMeta: Record<Category, { label: string; card: string; dot: string }> = {
  work: { label: '工作', card: 'plan-work', dot: 'bg-violet-500' },
  study: { label: '学习', card: 'plan-study', dot: 'bg-sky-500' },
  health: { label: '健康', card: 'plan-health', dot: 'bg-emerald-500' },
  life: { label: '生活', card: 'plan-life', dot: 'bg-amber-500' },
  other: { label: '其他', card: 'plan-other', dot: 'bg-zinc-500' },
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toISO(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromISO(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  const next = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  return next;
}

function startOfWeek(date: Date) {
  const day = date.getDay() || 7;
  return addDays(startOfDay(date), 1 - day);
}

function isSameDay(a: Date, b: Date) {
  return toISO(a) === toISO(b);
}

function formatChineseDate(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function minutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function createSamplePlans(today: Date): Plan[] {
  const monday = startOfWeek(today);
  return [
    {
      id: 'sample-1',
      title: '梳理本周目标',
      date: toISO(monday),
      startTime: '09:30',
      endTime: '10:30',
      category: 'life',
      note: '只保留三个最重要的结果。',
      completed: false,
      source: 'manual',
    },
    {
      id: 'sample-2',
      title: '产品方案评审',
      date: toISO(addDays(monday, 2)),
      startTime: '10:00',
      endTime: '11:30',
      category: 'work',
      note: '确认范围、负责人和交付节点。',
      completed: false,
      source: 'manual',
    },
    {
      id: 'sample-3',
      title: '健身 · 上肢训练',
      date: toISO(addDays(monday, 2)),
      startTime: '16:00',
      endTime: '17:00',
      category: 'health',
      note: '',
      completed: false,
      source: 'manual',
    },
    {
      id: 'sample-4',
      title: '阅读与笔记',
      date: toISO(addDays(monday, 3)),
      startTime: '20:00',
      endTime: '21:00',
      category: 'study',
      note: '读完第二章，整理五条笔记。',
      completed: false,
      source: 'manual',
    },
    {
      id: 'sample-5',
      title: '周度复盘',
      date: toISO(addDays(monday, 4)),
      startTime: '15:00',
      endTime: '16:00',
      category: 'work',
      note: '记录本周进展和下周优先级。',
      completed: false,
      source: 'quick',
    },
  ];
}

function localQuickParse(prompt: string, today: Date): PlanDraft {
  let target = startOfDay(today);
  if (prompt.includes('后天')) target = addDays(target, 2);
  else if (prompt.includes('明天')) target = addDays(target, 1);
  else {
    const weekMatch = prompt.match(/(?:下)?周([一二三四五六日天])/);
    if (weekMatch) {
      const dayIndex = '一二三四五六日天'.indexOf(weekMatch[1]);
      target = addDays(startOfWeek(today), dayIndex + (prompt.includes('下周') ? 7 : 0));
      if (target < startOfDay(today) && !prompt.includes('下周')) target = addDays(target, 7);
    }
  }

  let hour = prompt.includes('下午') || prompt.includes('晚上') ? 15 : 9;
  let minute = 0;
  const timeMatch = prompt.match(/(上午|下午|晚上)?\s*(\d{1,2})(?:[:：点时](\d{1,2})?)?/);
  if (timeMatch) {
    hour = Number(timeMatch[2]);
    minute = Number(timeMatch[3] || 0);
    if ((timeMatch[1] === '下午' || timeMatch[1] === '晚上') && hour < 12) hour += 12;
  }
  hour = Math.min(23, Math.max(0, hour));
  minute = Math.min(59, Math.max(0, minute));
  const endMinutes = Math.min(hour * 60 + minute + 60, 23 * 60 + 59);

  const cleanedTitle = prompt
    .replace(/今天|明天|后天|下?周[一二三四五六日天]/g, '')
    .replace(/上午|下午|晚上/g, '')
    .replace(/\d{1,2}(?:[:：点时]\d{0,2})?/g, '')
    .replace(/^[，,。\s]+|[，,。\s]+$/g, '') || '新计划';

  return {
    title: cleanedTitle.slice(0, 60),
    date: toISO(target),
    startTime: `${pad(hour)}:${pad(minute)}`,
    endTime: `${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}`,
    category: 'other',
    note: '由快捷计划解析',
  };
}

export default function Home() {
  const [view, setView] = useState<ViewMode>('week');
  const [section, setSection] = useState<Section>('calendar');
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [plans, setPlans] = useState<Plan[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft>(() => emptyDraft(new Date()));
  const [quickPrompt, setQuickPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<AiPreview | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      setPlans(saved ? JSON.parse(saved) : createSamplePlans(new Date()));
    } catch {
      setPlans(createSamplePlans(new Date()));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  }, [hydrated, plans]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const activePlans = useMemo(() => plans.filter((plan) => !plan.completed), [plans]);
  const inboxPlans = useMemo(
    () => plans.filter((plan) => !plan.completed && (plan.source === 'ai' || plan.source === 'quick')),
    [plans],
  );
  const completedPlans = useMemo(() => plans.filter((plan) => plan.completed), [plans]);

  const weekStart = startOfWeek(anchorDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const openCreate = (date = anchorDate, startTime = '09:00') => {
    const start = minutes(startTime);
    setEditingId(null);
    setDraft({
      ...emptyDraft(date),
      startTime,
      endTime: `${pad(Math.min(23, Math.floor((start + 60) / 60)))}:${pad((start + 60) % 60)}`,
    });
    setPlanModalOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingId(plan.id);
    setDraft({
      title: plan.title,
      date: plan.date,
      startTime: plan.startTime,
      endTime: plan.endTime,
      category: plan.category,
      note: plan.note,
    });
    setPlanModalOpen(true);
  };

  const savePlan = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    const normalized = {
      ...draft,
      title: draft.title.trim(),
      endTime: minutes(draft.endTime) > minutes(draft.startTime) ? draft.endTime : draft.startTime,
    };
    if (editingId) {
      setPlans((current) => current.map((plan) => (plan.id === editingId ? { ...plan, ...normalized } : plan)));
      setToast('计划已更新');
    } else {
      setPlans((current) => [...current, { ...normalized, id: newId(), completed: false, source: 'manual' }]);
      setToast('计划已添加');
    }
    setPlanModalOpen(false);
  };

  const deleteEditingPlan = () => {
    if (!editingId) return;
    setPlans((current) => current.filter((plan) => plan.id !== editingId));
    setPlanModalOpen(false);
    setToast('计划已删除');
  };

  const toggleCompleted = (id: string) => {
    setPlans((current) => current.map((plan) => (plan.id === id ? { ...plan, completed: !plan.completed } : plan)));
    setPlanModalOpen(false);
    setToast('完成状态已更新');
  };

  const submitQuickPlan = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = quickPrompt.trim();
    if (!prompt || aiLoading) return;
    setAiLoading(true);
    try {
      const response = await fetch('/api/ai-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          today: toISO(today),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!response.ok) throw new Error('AI service unavailable');
      const result = (await response.json()) as { summary?: string; plans?: PlanDraft[] };
      if (!result.plans?.length) throw new Error('No plans returned');
      setAiPreview({
        summary: result.summary || 'DeepSeek 已把你的目标拆成可执行计划。',
        plans: result.plans,
        source: 'ai',
      });
    } catch {
      setAiPreview({
        summary: 'DeepSeek 暂时没有响应，已先用本地快捷解析生成一条计划，你仍可编辑后添加。',
        plans: [localQuickParse(prompt, today)],
        source: 'quick',
      });
    } finally {
      setAiLoading(false);
    }
  };

  const addAiPlans = () => {
    if (!aiPreview) return;
    const incoming: Plan[] = aiPreview.plans.map((plan) => ({
      ...plan,
      id: newId(),
      completed: false,
      source: aiPreview.source,
    }));
    setPlans((current) => [...current, ...incoming]);
    setQuickPrompt('');
    setAiPreview(null);
    setToast(`已加入 ${incoming.length} 条计划`);
  };

  const shiftDate = (direction: -1 | 1) => {
    if (view === 'month') setAnchorDate((date) => addMonths(date, direction));
    else if (view === 'week') setAnchorDate((date) => addDays(date, direction * 7));
    else setAnchorDate((date) => addDays(date, direction));
  };

  const title = section === 'calendar' ? '我的计划' : section === 'inbox' ? '快捷收集箱' : '已完成';

  return (
    <main className="min-h-screen bg-white text-[#202020]">
      <Sidebar
        section={section}
        setSection={setSection}
        inboxCount={inboxPlans.length}
        completedCount={completedPlans.length}
        onCreate={() => openCreate()}
      />

      <section className="min-h-screen md:pl-[224px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#e4e4e4] bg-white/95 px-4 backdrop-blur md:px-7">
          <div>
            <h1 className="text-base font-semibold md:text-lg">{title}</h1>
            <p className="hidden text-xs text-[#777] sm:block">
              {section === 'calendar' ? '把重要的事，放进真实的时间里' : section === 'inbox' ? '快速捕捉，再从容安排' : '每一次完成都值得看见'}
            </p>
          </div>
          {section === 'calendar' && (
            <ViewSwitch value={view} onChange={setView} />
          )}
        </header>

        <div className="mx-auto max-w-[1500px] p-4 md:p-7">
          {section === 'calendar' ? (
            <>
              <PlannerToolbar
                view={view}
                anchorDate={anchorDate}
                weekStart={weekStart}
                quickPrompt={quickPrompt}
                setQuickPrompt={setQuickPrompt}
                loading={aiLoading}
                onSubmit={submitQuickPlan}
                onPrevious={() => shiftDate(-1)}
                onNext={() => shiftDate(1)}
                onToday={() => setAnchorDate(startOfDay(new Date()))}
              />

              {view === 'month' && (
                <MonthView
                  anchorDate={anchorDate}
                  today={today}
                  plans={activePlans}
                  onCreate={openCreate}
                  onEdit={openEdit}
                />
              )}
              {view === 'week' && (
                <WeekView
                  days={weekDays}
                  today={today}
                  plans={activePlans}
                  onCreate={openCreate}
                  onEdit={openEdit}
                />
              )}
              {view === 'day' && (
                <DayView
                  day={anchorDate}
                  today={today}
                  plans={activePlans}
                  onCreate={openCreate}
                  onEdit={openEdit}
                />
              )}
            </>
          ) : (
            <PlanList
              plans={section === 'inbox' ? inboxPlans : completedPlans}
              emptyText={section === 'inbox' ? '还没有通过快捷计划添加的事项' : '还没有完成的计划'}
              onEdit={openEdit}
              onToggle={toggleCompleted}
            />
          )}
        </div>

        <MobileNav section={section} setSection={setSection} onCreate={() => openCreate()} />
      </section>

      {planModalOpen && (
        <PlanModal
          draft={draft}
          setDraft={setDraft}
          editing={Boolean(editingId)}
          completed={editingId ? Boolean(plans.find((plan) => plan.id === editingId)?.completed) : false}
          onSubmit={savePlan}
          onClose={() => setPlanModalOpen(false)}
          onDelete={deleteEditingPlan}
          onToggleCompleted={() => editingId && toggleCompleted(editingId)}
        />
      )}

      {aiPreview && (
        <AiPreviewModal preview={aiPreview} onClose={() => setAiPreview(null)} onAdd={addAiPlans} />
      )}

      {toast && (
        <div role="status" className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-4 py-2.5 text-xs font-medium text-white shadow-xl md:bottom-6">
          <Check className="size-3.5" /> {toast}
        </div>
      )}
    </main>
  );
}

function emptyDraft(date: Date): PlanDraft {
  return {
    title: '',
    date: toISO(date),
    startTime: '09:00',
    endTime: '10:00',
    category: 'work',
    note: '',
  };
}

function Sidebar({
  section,
  setSection,
  inboxCount,
  completedCount,
  onCreate,
}: {
  section: Section;
  setSection: (section: Section) => void;
  inboxCount: number;
  completedCount: number;
  onCreate: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[224px] border-r border-[#dedede] bg-[#f6f6f6] p-3 md:flex md:flex-col">
      <div className="flex items-center gap-2.5 px-2 py-2">
        <div className="grid size-8 place-items-center rounded-lg bg-black text-sm font-bold text-white">K</div>
        <div>
          <p className="text-sm font-semibold">Kekaku</p>
          <p className="text-[11px] text-[#777]">让计划真正发生</p>
        </div>
      </div>

      <button onClick={onCreate} className="mt-4 flex h-10 items-center justify-center gap-2 rounded-lg bg-black text-sm font-medium text-white shadow-sm transition hover:bg-[#292929]">
        <CirclePlus className="size-4" /> 新建计划
      </button>

      <nav className="mt-5 space-y-1 text-sm">
        <SideNavButton active={section === 'calendar'} onClick={() => setSection('calendar')} icon={<CalendarDays className="size-4" />} label="我的计划" />
        <SideNavButton active={section === 'inbox'} onClick={() => setSection('inbox')} icon={<Inbox className="size-4" />} label="快捷收集箱" count={inboxCount} />
        <SideNavButton active={section === 'completed'} onClick={() => setSection('completed')} icon={<CheckCircle2 className="size-4" />} label="已完成" count={completedCount} />
      </nav>

      <div className="mt-7 px-3 text-[10px] font-semibold uppercase tracking-[.12em] text-[#999]">分类</div>
      <div className="mt-2 space-y-2 px-3">
        {(Object.keys(categoryMeta) as Category[]).map((category) => (
          <div key={category} className="flex items-center gap-2 text-xs text-[#666]">
            <span className={`size-2 rounded-full ${categoryMeta[category].dot}`} /> {categoryMeta[category].label}
          </div>
        ))}
      </div>

      <div className="mt-auto rounded-lg border border-[#dfdfdf] bg-white p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium"><Sparkles className="size-3.5 text-violet-600" /> DeepSeek 计划助手</div>
        <p className="text-[11px] leading-5 text-[#777]">说出目标，AI 帮你拆成今天能完成的步骤。</p>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500" /> 服务端安全连接</div>
      </div>
    </aside>
  );
}

function SideNavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left font-medium transition ${active ? 'bg-[#e9e9e9] text-[#202020]' : 'text-[#666] hover:bg-[#ededed]'}`}>
      {icon} {label} {typeof count === 'number' && count > 0 && <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 text-[10px] text-[#666]">{count}</span>}
    </button>
  );
}

function ViewSwitch({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }) {
  const options: { value: ViewMode; label: string; icon: React.ReactNode }[] = [
    { value: 'month', label: '月', icon: <CalendarRange className="size-3.5" /> },
    { value: 'week', label: '周', icon: <CalendarDays className="size-3.5" /> },
    { value: 'day', label: '日', icon: <Calendar1 className="size-3.5" /> },
  ];
  return (
    <div className="flex rounded-lg border border-[#dedede] bg-[#f6f6f6] p-1 text-xs font-medium">
      {options.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)} aria-pressed={value === option.value} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition sm:px-3 ${value === option.value ? 'bg-white text-black shadow-sm' : 'text-[#666] hover:text-black'}`}>
          <span className="hidden sm:block">{option.icon}</span>{option.label}
        </button>
      ))}
    </div>
  );
}

function PlannerToolbar({
  view,
  anchorDate,
  weekStart,
  quickPrompt,
  setQuickPrompt,
  loading,
  onSubmit,
  onPrevious,
  onNext,
  onToday,
}: {
  view: ViewMode;
  anchorDate: Date;
  weekStart: Date;
  quickPrompt: string;
  setQuickPrompt: (value: string) => void;
  loading: boolean;
  onSubmit: (event: FormEvent) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const rangeTitle = view === 'month'
    ? `${anchorDate.getFullYear()}年 ${anchorDate.getMonth() + 1}月`
    : view === 'week'
      ? `${weekStart.getFullYear()}年 ${formatChineseDate(weekStart)}–${formatChineseDate(addDays(weekStart, 6))}`
      : `${anchorDate.getFullYear()}年 ${formatChineseDate(anchorDate)} · ${weekdayNames[(anchorDate.getDay() + 6) % 7]}`;

  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <button onClick={onPrevious} aria-label="上一段时间" className="icon-button"><ChevronLeft className="size-4" /></button>
          <button onClick={onNext} aria-label="下一段时间" className="icon-button"><ChevronRight className="size-4" /></button>
          <button onClick={onToday} className="ml-1 rounded-md border border-[#dedede] px-3 py-2 text-xs font-medium hover:bg-[#f6f6f6]">今天</button>
          <h2 className="ml-1 text-base font-semibold sm:text-lg">{rangeTitle}</h2>
        </div>

        <form onSubmit={onSubmit} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#d8d8d8] bg-[#fafafa] p-1.5 transition focus-within:border-[#999] focus-within:bg-white lg:max-w-[520px]">
          <Sparkles className="ml-2 size-4 shrink-0 text-violet-600" />
          <input value={quickPrompt} onChange={(event) => setQuickPrompt(event.target.value)} className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none" placeholder="快捷计划：下周完成发布准备，每天安排 1 小时" aria-label="快捷计划描述" />
          <button disabled={!quickPrompt.trim() || loading} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-medium text-white transition hover:bg-[#292929] disabled:cursor-not-allowed disabled:opacity-40">
            {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
            <span className="hidden sm:inline">{loading ? '思考中' : 'AI 安排'}</span>
          </button>
        </form>
      </div>
      <p className="text-[11px] text-[#888] lg:text-right">支持自然语言输入，DeepSeek 会自动识别日期、时间并拆解复杂目标</p>
    </div>
  );
}

function MonthView({ anchorDate, today, plans, onCreate, onEdit }: { anchorDate: Date; today: Date; plans: Plan[]; onCreate: (date: Date) => void; onEdit: (plan: Plan) => void }) {
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  return (
    <div className="overflow-auto rounded-xl border border-[#dedede] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04)]">
      <div className="grid min-w-[760px] grid-cols-7 border-b border-[#dedede] bg-[#fafafa]">
        {monthWeekdays.map((day) => <div key={day} className="px-3 py-3 text-center text-[11px] font-medium text-[#777]">周{day}</div>)}
      </div>
      <div className="grid min-w-[760px] grid-cols-7">
        {days.map((day) => {
          const dayPlans = plans.filter((plan) => plan.date === toISO(day)).sort((a, b) => a.startTime.localeCompare(b.startTime));
          const outside = day.getMonth() !== anchorDate.getMonth();
          return (
            <div key={toISO(day)} onDoubleClick={() => onCreate(day)} className={`group min-h-[132px] border-b border-r border-[#e7e7e7] p-2 last:border-r-0 ${outside ? 'bg-[#fafafa] text-[#aaa]' : 'bg-white'} ${isSameDay(day, today) ? 'bg-violet-50/30' : ''}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${isSameDay(day, today) ? 'bg-black text-white' : ''}`}>{day.getDate()}</span>
                <button onClick={() => onCreate(day)} aria-label={`${formatChineseDate(day)}新建计划`} className="grid size-6 place-items-center rounded-md text-[#888] opacity-0 hover:bg-[#eee] group-hover:opacity-100"><CirclePlus className="size-3.5" /></button>
              </div>
              <div className="space-y-1">
                {dayPlans.slice(0, 3).map((plan) => (
                  <button key={plan.id} onClick={() => onEdit(plan)} className={`block w-full truncate rounded px-1.5 py-1 text-left text-[10px] font-medium ${categoryMeta[plan.category].card}`}>
                    <span className="mr-1 opacity-60">{plan.startTime}</span>{plan.title}
                  </button>
                ))}
                {dayPlans.length > 3 && <p className="px-1 text-[10px] text-[#777]">还有 {dayPlans.length - 3} 项</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ days, today, plans, onCreate, onEdit }: { days: Date[]; today: Date; plans: Plan[]; onCreate: (date: Date, time?: string) => void; onEdit: (plan: Plan) => void }) {
  return (
    <div className="overflow-auto rounded-xl border border-[#dedede] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04)]">
      <div className="grid min-w-[920px] grid-cols-[56px_repeat(7,minmax(122px,1fr))] border-b border-[#dedede] bg-[#fafafa]">
        <div />
        {days.map((day, index) => (
          <div key={toISO(day)} className="border-l border-[#e6e6e6] px-3 py-3 text-center">
            <p className="text-[11px] text-[#777]">{weekdayNames[index]}</p>
            <span className={`mt-1 inline-grid size-7 place-items-center rounded-full text-sm font-semibold ${isSameDay(day, today) ? 'bg-black text-white' : ''}`}>{day.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="relative grid h-[780px] min-w-[920px] grid-cols-[56px_repeat(7,minmax(122px,1fr))] bg-[linear-gradient(to_bottom,transparent_59px,#ececec_60px)] bg-[length:100%_60px]">
        <div className="relative">
          {timelineHours.map((hour, index) => <span key={hour} className="absolute right-3 -translate-y-1/2 text-[10px] text-[#999]" style={{ top: index * 60 }}>{pad(hour)}:00</span>)}
        </div>
        {days.map((day) => {
          const dayPlans = plans.filter((plan) => plan.date === toISO(day));
          return (
            <div key={toISO(day)} className={`relative border-l border-[#e6e6e6] ${isSameDay(day, today) ? 'bg-violet-50/30' : ''}`} onDoubleClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const rawHour = 8 + Math.floor((event.clientY - rect.top) / 60);
              openCreateAt(onCreate, day, rawHour);
            }}>
              {dayPlans.map((plan) => <TimelinePlan key={plan.id} plan={plan} onEdit={onEdit} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ day, today, plans, onCreate, onEdit }: { day: Date; today: Date; plans: Plan[]; onCreate: (date: Date, time?: string) => void; onEdit: (plan: Plan) => void }) {
  const dayPlans = plans.filter((plan) => plan.date === toISO(day));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="overflow-hidden rounded-xl border border-[#dedede] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04)]">
        <div className="flex items-center justify-between border-b border-[#dedede] bg-[#fafafa] px-5 py-4">
          <div className="flex items-center gap-3"><span className={`grid size-9 place-items-center rounded-full text-sm font-semibold ${isSameDay(day, today) ? 'bg-black text-white' : 'bg-[#ededed]'}`}>{day.getDate()}</span><div><p className="text-sm font-semibold">{weekdayNames[(day.getDay() + 6) % 7]}</p><p className="text-[11px] text-[#777]">{formatChineseDate(day)}</p></div></div>
          <button onClick={() => onCreate(day)} className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-medium text-white"><CirclePlus className="size-3.5" />添加</button>
        </div>
        <div className="relative grid h-[780px] grid-cols-[64px_1fr] bg-[linear-gradient(to_bottom,transparent_59px,#ececec_60px)] bg-[length:100%_60px]">
          <div className="relative">{timelineHours.map((hour, index) => <span key={hour} className="absolute right-3 -translate-y-1/2 text-[10px] text-[#999]" style={{ top: index * 60 }}>{pad(hour)}:00</span>)}</div>
          <div className="relative border-l border-[#e6e6e6]" onDoubleClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openCreateAt(onCreate, day, 8 + Math.floor((event.clientY - rect.top) / 60));
          }}>
            {dayPlans.map((plan) => <TimelinePlan key={plan.id} plan={plan} onEdit={onEdit} wide />)}
          </div>
        </div>
      </div>
      <aside className="h-fit rounded-xl border border-[#dedede] bg-[#fafafa] p-4">
        <p className="text-xs font-semibold">今日摘要</p>
        <div className="mt-3 flex items-end gap-2"><span className="text-3xl font-semibold">{dayPlans.length}</span><span className="pb-1 text-xs text-[#777]">项计划</span></div>
        <div className="mt-4 space-y-3">
          {dayPlans.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((plan) => (
            <button key={plan.id} onClick={() => onEdit(plan)} className="flex w-full items-start gap-2 text-left">
              <span className={`mt-1 size-2 rounded-full ${categoryMeta[plan.category].dot}`} />
              <span><span className="block text-xs font-medium">{plan.title}</span><span className="text-[10px] text-[#777]">{plan.startTime}–{plan.endTime}</span></span>
            </button>
          ))}
          {!dayPlans.length && <p className="text-xs leading-5 text-[#888]">今天还没有安排。双击时间轴即可快速添加。</p>}
        </div>
      </aside>
    </div>
  );
}

function openCreateAt(onCreate: (date: Date, time?: string) => void, day: Date, hour: number) {
  const safeHour = Math.max(0, Math.min(23, hour));
  onCreate(day, `${pad(safeHour)}:00`);
}

function TimelinePlan({ plan, onEdit, wide = false }: { plan: Plan; onEdit: (plan: Plan) => void; wide?: boolean }) {
  const start = minutes(plan.startTime);
  const end = Math.max(start + 30, minutes(plan.endTime));
  const top = ((start - 8 * 60) / 60) * 60;
  const height = Math.max(36, ((end - start) / 60) * 60 - 3);
  if (top < -height || top > 780) return null;
  return (
    <button onClick={() => onEdit(plan)} className={`absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-md border p-2 text-left shadow-sm transition hover:-translate-y-px hover:shadow-md ${categoryMeta[plan.category].card} ${wide ? 'max-w-2xl' : ''}`} style={{ top: Math.max(0, top), height }}>
      <p className="truncate text-[11px] font-semibold">{plan.title}</p>
      {height > 42 && <p className="mt-1 flex items-center gap-1 text-[9px] opacity-70"><Clock3 className="size-2.5" />{plan.startTime}–{plan.endTime}</p>}
    </button>
  );
}

function PlanList({ plans, emptyText, onEdit, onToggle }: { plans: Plan[]; emptyText: string; onEdit: (plan: Plan) => void; onToggle: (id: string) => void }) {
  const sorted = [...plans].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between"><p className="text-sm text-[#777]">共 {sorted.length} 项</p></div>
      <div className="overflow-hidden rounded-xl border border-[#dedede] bg-white">
        {sorted.map((plan) => (
          <div key={plan.id} className="flex items-center gap-3 border-b border-[#ececec] p-4 last:border-b-0 hover:bg-[#fafafa]">
            <button onClick={() => onToggle(plan.id)} aria-label={plan.completed ? '恢复为未完成' : '标记为已完成'} className={`grid size-6 shrink-0 place-items-center rounded-full border ${plan.completed ? 'border-black bg-black text-white' : 'border-[#ccc] text-transparent hover:text-[#999]'}`}><Check className="size-3.5" /></button>
            <button onClick={() => onEdit(plan)} className="min-w-0 flex-1 text-left">
              <p className={`truncate text-sm font-medium ${plan.completed ? 'text-[#888] line-through' : ''}`}>{plan.title}</p>
              <p className="mt-1 text-[11px] text-[#777]">{plan.date} · {plan.startTime}–{plan.endTime} · {categoryMeta[plan.category].label}</p>
            </button>
            {plan.source !== 'manual' && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] text-violet-700">{plan.source === 'ai' ? 'DeepSeek' : '快捷'}</span>}
          </div>
        ))}
        {!sorted.length && <div className="grid min-h-64 place-items-center p-8 text-center"><div><Inbox className="mx-auto size-8 text-[#bbb]" /><p className="mt-3 text-sm font-medium">这里还是空的</p><p className="mt-1 text-xs text-[#888]">{emptyText}</p></div></div>}
      </div>
    </div>
  );
}

function PlanModal({ draft, setDraft, editing, completed, onSubmit, onClose, onDelete, onToggleCompleted }: { draft: PlanDraft; setDraft: (draft: PlanDraft) => void; editing: boolean; completed: boolean; onSubmit: (event: FormEvent) => void; onClose: () => void; onDelete: () => void; onToggleCompleted: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={onSubmit} className="modal-card max-w-[520px]">
        <div className="flex items-center justify-between border-b border-[#e7e7e7] px-5 py-4"><div><h2 className="text-base font-semibold">{editing ? '编辑计划' : '新建计划'}</h2><p className="mt-0.5 text-[11px] text-[#777]">给重要的事留出明确时间</p></div><button type="button" onClick={onClose} className="icon-button border-0"><X className="size-4" /></button></div>
        <div className="space-y-4 p-5">
          <label className="field-label">计划标题<input autoFocus required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="field-input" placeholder="例如：完成产品方案初稿" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="field-label col-span-2 sm:col-span-1">日期<input required type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="field-input" /></label>
            <label className="field-label col-span-2 sm:col-span-1">分类<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })} className="field-input">{(Object.keys(categoryMeta) as Category[]).map((category) => <option key={category} value={category}>{categoryMeta[category].label}</option>)}</select></label>
            <label className="field-label">开始<input required type="time" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} className="field-input" /></label>
            <label className="field-label">结束<input required type="time" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} className="field-input" /></label>
          </div>
          <label className="field-label">备注<textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className="field-input min-h-24 resize-none" placeholder="补充目标、资料或完成标准（可选）" /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#e7e7e7] px-5 py-4">
          {editing && <button type="button" onClick={onDelete} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"><Trash2 className="size-3.5" />删除</button>}
          {editing && <button type="button" onClick={onToggleCompleted} className="rounded-lg border border-[#d8d8d8] px-3 py-2 text-xs font-medium hover:bg-[#f6f6f6]">{completed ? '恢复未完成' : '标记完成'}</button>}
          <div className="ml-auto flex gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[#d8d8d8] px-4 py-2 text-xs font-medium hover:bg-[#f6f6f6]">取消</button><button className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-[#292929]">{editing ? '保存更改' : '添加计划'}</button></div>
        </div>
      </form>
    </div>
  );
}

function AiPreviewModal({ preview, onClose, onAdd }: { preview: AiPreview; onClose: () => void; onAdd: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card max-w-[620px]">
        <div className="flex items-start justify-between border-b border-[#e7e7e7] px-5 py-4"><div className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700"><Sparkles className="size-4" /></div><div><h2 className="text-base font-semibold">智能安排预览</h2><p className="mt-1 max-w-md text-xs leading-5 text-[#777]">{preview.summary}</p></div></div><button onClick={onClose} className="icon-button border-0"><X className="size-4" /></button></div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-5">
          {preview.plans.map((plan, index) => (
            <div key={`${plan.date}-${plan.title}-${index}`} className="flex items-start gap-3 rounded-lg border border-[#e1e1e1] p-3">
              <span className={`mt-1 size-2 rounded-full ${categoryMeta[plan.category]?.dot || categoryMeta.other.dot}`} />
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{plan.title}</p>{plan.note && <p className="mt-1 text-[11px] leading-5 text-[#777]">{plan.note}</p>}<p className="mt-2 flex items-center gap-1.5 text-[10px] text-[#666]"><CalendarDays className="size-3" />{plan.date}<Clock3 className="ml-1 size-3" />{plan.startTime}–{plan.endTime}</p></div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e7e7e7] px-5 py-4"><button onClick={onClose} className="rounded-lg border border-[#d8d8d8] px-4 py-2 text-xs font-medium">返回修改</button><button onClick={onAdd} className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white"><Check className="size-3.5" />加入全部计划</button></div>
      </section>
    </div>
  );
}

function MobileNav({ section, setSection, onCreate }: { section: Section; setSection: (section: Section) => void; onCreate: () => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-[#dedede] bg-white/95 px-3 py-2 backdrop-blur md:hidden">
      <button onClick={() => setSection('calendar')} className={`mobile-nav-item ${section === 'calendar' ? 'text-black' : 'text-[#888]'}`}><LayoutGrid className="size-5" />计划</button>
      <button onClick={onCreate} className="mobile-nav-item text-[#555]"><CirclePlus className="size-5" />新建</button>
      <button onClick={() => setSection('inbox')} className={`mobile-nav-item ${section === 'inbox' ? 'text-black' : 'text-[#888]'}`}><Sparkles className="size-5" />AI 计划</button>
      <button onClick={() => setSection('completed')} className={`mobile-nav-item ${section === 'completed' ? 'text-black' : 'text-[#888]'}`}><CheckCircle2 className="size-5" />完成</button>
    </nav>
  );
}
