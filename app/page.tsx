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
  GripVertical,
  Inbox,
  LayoutGrid,
  ListTodo,
  LoaderCircle,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { DragEvent as ReactDragEvent, FormEvent, useEffect, useMemo, useState } from 'react';

type ViewMode = 'month' | 'week' | 'day';
type Category = 'work' | 'study' | 'health' | 'life' | 'other';
type Section = 'calendar' | 'inbox' | 'completed';
type Source = 'manual' | 'ai' | 'quick';
type PoolScope = 'week' | 'month';
type Priority = 'high' | 'medium' | 'low';

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
  poolId?: string;
};

type PlanDraft = Omit<Plan, 'id' | 'completed' | 'source'>;

type AiPreview = {
  summary: string;
  plans: PlanDraft[];
  source: 'ai' | 'quick';
};

type PoolItem = {
  id: string;
  title: string;
  scope: PoolScope;
  duration: number;
  priority: Priority;
  category: Category;
  note: string;
  scheduled: boolean;
};

type PoolDraft = Omit<PoolItem, 'id' | 'scheduled'>;
type DragPayload = { kind: 'plan' | 'pool'; id: string };
type CalendarDragProps = {
  onDrop: (event: ReactDragEvent, date: Date, startTime?: string) => void;
  onDragStart: (event: ReactDragEvent, payload: DragPayload) => void;
  onDragEnd: () => void;
  dropTarget: string | null;
  setDropTarget: (value: string | null) => void;
};

const STORAGE_KEY = 'kekaku-plans-v1';
const POOL_STORAGE_KEY = 'kekaku-plan-pool-v1';
const DRAG_MIME = 'application/x-kekaku-plan';
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

const priorityMeta: Record<Priority, { label: string; className: string }> = {
  high: { label: '高优先', className: 'bg-red-50 text-red-700' },
  medium: { label: '中优先', className: 'bg-amber-50 text-amber-700' },
  low: { label: '低优先', className: 'bg-zinc-100 text-zinc-600' },
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

function durationLabel(value: number) {
  if (value < 60) return `${value} 分钟`;
  if (value % 60 === 0) return `${value / 60} 小时`;
  return `${Math.floor(value / 60)} 小时 ${value % 60} 分`;
}

function addMinutesToTime(value: string, amount: number) {
  const total = Math.min(23 * 60 + 59, Math.max(0, minutes(value) + amount));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function readDragPayload(event: ReactDragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData(DRAG_MIME);
    if (!raw) return null;
    const payload = JSON.parse(raw) as DragPayload;
    return (payload.kind === 'plan' || payload.kind === 'pool') && payload.id ? payload : null;
  } catch {
    return null;
  }
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

function createSamplePool(): PoolItem[] {
  return [
    { id: 'pool-1', title: '准备产品发布材料', scope: 'week', duration: 180, priority: 'high', category: 'work', note: '整理发布清单、文案和演示素材', scheduled: false },
    { id: 'pool-2', title: '完成季度阅读清单', scope: 'week', duration: 120, priority: 'medium', category: 'study', note: '读完剩余章节并做摘录', scheduled: false },
    { id: 'pool-3', title: '整理旅行照片', scope: 'month', duration: 90, priority: 'low', category: 'life', note: '筛选、归档并挑选 20 张', scheduled: false },
    { id: 'pool-4', title: '安排一次长距离慢跑', scope: 'month', duration: 90, priority: 'medium', category: 'health', note: '选择天气合适的周末上午', scheduled: false },
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

function createLocalPoolSchedule(items: PoolItem[], rangeStart: Date, rangeEnd: Date, existing: Plan[]): PlanDraft[] {
  const occupied = existing.map((plan) => ({ date: plan.date, start: minutes(plan.startTime), end: minutes(plan.endTime) }));
  const ordered = [...items].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority));
  const results: PlanDraft[] = [];

  for (const item of ordered) {
    let placed = false;
    for (let day = startOfDay(rangeStart); day <= rangeEnd && !placed; day = addDays(day, 1)) {
      for (let start = 9 * 60; start + item.duration <= 21 * 60; start += 30) {
        const date = toISO(day);
        const end = start + item.duration;
        const conflicts = occupied.some((slot) => slot.date === date && start < slot.end && end > slot.start);
        if (!conflicts) {
          const draft: PlanDraft = {
            title: item.title,
            date,
            startTime: `${pad(Math.floor(start / 60))}:${pad(start % 60)}`,
            endTime: `${pad(Math.floor(end / 60))}:${pad(end % 60)}`,
            category: item.category,
            note: item.note || `计划池 · ${priorityMeta[item.priority].label}`,
            poolId: item.id,
          };
          results.push(draft);
          occupied.push({ date, start, end });
          placed = true;
          break;
        }
      }
    }
  }
  return results;
}

export default function Home() {
  const [view, setView] = useState<ViewMode>('week');
  const [section, setSection] = useState<Section>('calendar');
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [plans, setPlans] = useState<Plan[]>([]);
  const [poolItems, setPoolItems] = useState<PoolItem[]>([]);
  const [poolScope, setPoolScope] = useState<PoolScope>('week');
  const [poolOpen, setPoolOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft>(() => emptyDraft(new Date()));
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolEditingId, setPoolEditingId] = useState<string | null>(null);
  const [poolDraft, setPoolDraft] = useState<PoolDraft>(() => emptyPoolDraft('week'));
  const [quickPrompt, setQuickPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [poolAiLoading, setPoolAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<AiPreview | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      setPlans(saved ? JSON.parse(saved) : createSamplePlans(new Date()));
      const savedPool = localStorage.getItem(POOL_STORAGE_KEY);
      setPoolItems(savedPool ? JSON.parse(savedPool) : createSamplePool());
    } catch {
      setPlans(createSamplePlans(new Date()));
      setPoolItems(createSamplePool());
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  }, [hydrated, plans]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(poolItems));
  }, [hydrated, poolItems]);

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
  const visiblePoolItems = useMemo(
    () => poolItems.filter((item) => item.scope === poolScope && !item.scheduled),
    [poolItems, poolScope],
  );

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
      poolId: plan.poolId,
    });
    setPlanModalOpen(true);
  };

  const openPoolCreate = () => {
    setPoolEditingId(null);
    setPoolDraft(emptyPoolDraft(poolScope));
    setPoolModalOpen(true);
  };

  const openPoolEdit = (item: PoolItem) => {
    setPoolEditingId(item.id);
    setPoolDraft({ title: item.title, scope: item.scope, duration: item.duration, priority: item.priority, category: item.category, note: item.note });
    setPoolModalOpen(true);
  };

  const savePoolItem = (event: FormEvent) => {
    event.preventDefault();
    if (!poolDraft.title.trim()) return;
    if (poolEditingId) {
      setPoolItems((current) => current.map((item) => item.id === poolEditingId ? { ...item, ...poolDraft, title: poolDraft.title.trim() } : item));
      setToast('计划池事项已更新');
    } else {
      setPoolItems((current) => [...current, { ...poolDraft, title: poolDraft.title.trim(), id: newId(), scheduled: false }]);
      setPoolScope(poolDraft.scope);
      setToast('已放入计划池');
    }
    setPoolModalOpen(false);
  };

  const deletePoolItem = () => {
    if (!poolEditingId) return;
    setPoolItems((current) => current.filter((item) => item.id !== poolEditingId));
    setPlans((current) => current.filter((plan) => plan.poolId !== poolEditingId));
    setPoolModalOpen(false);
    setToast('已从计划池删除');
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
    const target = plans.find((plan) => plan.id === editingId);
    setPlans((current) => current.filter((plan) => plan.id !== editingId));
    if (target?.poolId) setPoolItems((current) => current.map((item) => item.id === target.poolId ? { ...item, scheduled: false } : item));
    setPlanModalOpen(false);
    setToast('计划已删除');
  };

  const toggleCompleted = (id: string) => {
    setPlans((current) => current.map((plan) => (plan.id === id ? { ...plan, completed: !plan.completed } : plan)));
    setPlanModalOpen(false);
    setToast('完成状态已更新');
  };

  const startDragging = (event: ReactDragEvent, payload: DragPayload) => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
    setDragging(payload);
  };

  const finishDragging = () => {
    setDragging(null);
    setDropTarget(null);
  };

  const dropOnCalendar = (event: ReactDragEvent, date: Date, startTime?: string) => {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (!payload) return finishDragging();
    const dateValue = toISO(date);

    if (payload.kind === 'plan') {
      setPlans((current) => current.map((plan) => {
        if (plan.id !== payload.id) return plan;
        const duration = Math.max(30, minutes(plan.endTime) - minutes(plan.startTime));
        const nextStart = startTime || plan.startTime;
        return { ...plan, date: dateValue, startTime: nextStart, endTime: addMinutesToTime(nextStart, duration) };
      }));
      setToast('计划时间已调整');
    } else {
      const item = poolItems.find((candidate) => candidate.id === payload.id);
      if (item) {
        const nextStart = startTime || '09:00';
        setPlans((current) => [...current, {
          id: newId(), title: item.title, date: dateValue, startTime: nextStart,
          endTime: addMinutesToTime(nextStart, item.duration), category: item.category,
          note: item.note, completed: false, source: 'manual', poolId: item.id,
        }]);
        setPoolItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, scheduled: true } : candidate));
        setToast('已从计划池安排到日历');
      }
    }
    finishDragging();
  };

  const dropBackToPool = (event: ReactDragEvent) => {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (!payload || payload.kind !== 'plan') return finishDragging();
    const plan = plans.find((candidate) => candidate.id === payload.id);
    if (!plan) return finishDragging();
    if (plan.poolId) {
      setPoolItems((current) => current.map((item) => item.id === plan.poolId ? { ...item, scheduled: false } : item));
    } else {
      const planDate = fromISO(plan.date);
      const isCurrentWeek = planDate >= startOfWeek(anchorDate) && planDate <= addDays(startOfWeek(anchorDate), 6);
      setPoolItems((current) => [...current, {
        id: newId(), title: plan.title, scope: isCurrentWeek ? 'week' : 'month',
        duration: Math.max(30, minutes(plan.endTime) - minutes(plan.startTime)), priority: 'medium',
        category: plan.category, note: plan.note, scheduled: false,
      }]);
    }
    setPlans((current) => current.filter((candidate) => candidate.id !== plan.id));
    setToast('已取消排期并放回计划池');
    finishDragging();
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

  const autoSchedulePool = async () => {
    if (!visiblePoolItems.length || poolAiLoading) {
      if (!visiblePoolItems.length) setToast(`${poolScope === 'week' ? '本周' : '本月'}计划池还没有待安排事项`);
      return;
    }
    const rangeStart = poolScope === 'week' ? startOfWeek(anchorDate) : new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const rangeEnd = poolScope === 'week' ? addDays(rangeStart, 6) : new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
    const existing = activePlans.filter((plan) => plan.date >= toISO(rangeStart) && plan.date <= toISO(rangeEnd));
    setPoolAiLoading(true);
    try {
      const response = await fetch('/api/ai-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: visiblePoolItems,
          existingPlans: existing.map(({ title, date, startTime, endTime }) => ({ title, date, startTime, endTime })),
          rangeStart: toISO(rangeStart),
          rangeEnd: toISO(rangeEnd),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!response.ok) throw new Error('AI scheduling unavailable');
      const result = (await response.json()) as { summary?: string; plans?: PlanDraft[] };
      if (!result.plans?.length) throw new Error('No schedule returned');
      setAiPreview({ summary: result.summary || 'DeepSeek 已结合优先级、时长和现有日程完成排期。', plans: result.plans, source: 'ai' });
    } catch {
      const fallback = createLocalPoolSchedule(visiblePoolItems, rangeStart, rangeEnd, existing);
      setAiPreview({ summary: 'DeepSeek 暂时没有响应，已用本地无冲突规则生成排期，你可以预览后加入。', plans: fallback, source: 'quick' });
    } finally {
      setPoolAiLoading(false);
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
    const scheduledPoolIds = new Set(incoming.map((plan) => plan.poolId).filter(Boolean));
    if (scheduledPoolIds.size) {
      setPoolItems((current) => current.map((item) => scheduledPoolIds.has(item.id) ? { ...item, scheduled: true } : item));
    }
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
            <div className="flex items-center gap-2">
              <button onClick={() => setPoolOpen((open) => !open)} aria-pressed={poolOpen} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition ${poolOpen ? 'border-black bg-black text-white' : 'border-[#dedede] bg-white hover:bg-[#f6f6f6]'}`}>
                <ListTodo className="size-3.5" /><span className="hidden sm:inline">计划池</span><span className="rounded-full bg-white/15 px-1.5 text-[9px]">{visiblePoolItems.length}</span>
              </button>
              <ViewSwitch value={view} onChange={setView} />
            </div>
          )}
        </header>

        <div className={`mx-auto max-w-[1500px] p-4 md:p-7 ${section === 'calendar' && poolOpen ? 'xl:pr-[356px]' : ''}`}>
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
                  onDrop={dropOnCalendar}
                  onDragStart={startDragging}
                  onDragEnd={finishDragging}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                />
              )}
              {view === 'week' && (
                <WeekView
                  days={weekDays}
                  today={today}
                  plans={activePlans}
                  onCreate={openCreate}
                  onEdit={openEdit}
                  onDrop={dropOnCalendar}
                  onDragStart={startDragging}
                  onDragEnd={finishDragging}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                />
              )}
              {view === 'day' && (
                <DayView
                  day={anchorDate}
                  today={today}
                  plans={activePlans}
                  onCreate={openCreate}
                  onEdit={openEdit}
                  onDrop={dropOnCalendar}
                  onDragStart={startDragging}
                  onDragEnd={finishDragging}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
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

      {section === 'calendar' && (
        <PlanPool
          open={poolOpen}
          scope={poolScope}
          setScope={setPoolScope}
          items={visiblePoolItems}
          allItems={poolItems}
          loading={poolAiLoading}
          dragging={dragging}
          onClose={() => setPoolOpen(false)}
          onCreate={openPoolCreate}
          onEdit={openPoolEdit}
          onAutoSchedule={autoSchedulePool}
          onDragStart={startDragging}
          onDragEnd={finishDragging}
          onDropBack={dropBackToPool}
        />
      )}

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

      {poolModalOpen && (
        <PoolModal
          draft={poolDraft}
          setDraft={setPoolDraft}
          editing={Boolean(poolEditingId)}
          onSubmit={savePoolItem}
          onClose={() => setPoolModalOpen(false)}
          onDelete={deletePoolItem}
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

function PlanPool({
  open,
  scope,
  setScope,
  items,
  allItems,
  loading,
  dragging,
  onClose,
  onCreate,
  onEdit,
  onAutoSchedule,
  onDragStart,
  onDragEnd,
  onDropBack,
}: {
  open: boolean;
  scope: PoolScope;
  setScope: (scope: PoolScope) => void;
  items: PoolItem[];
  allItems: PoolItem[];
  loading: boolean;
  dragging: DragPayload | null;
  onClose: () => void;
  onCreate: () => void;
  onEdit: (item: PoolItem) => void;
  onAutoSchedule: () => void;
  onDragStart: (event: ReactDragEvent, payload: DragPayload) => void;
  onDragEnd: () => void;
  onDropBack: (event: ReactDragEvent) => void;
}) {
  const total = allItems.filter((item) => item.scope === scope).length;
  const scheduled = allItems.filter((item) => item.scope === scope && item.scheduled).length;
  return (
    <>
      {open && <button aria-label="关闭计划池" onClick={onClose} className="fixed inset-0 top-16 z-30 bg-black/20 backdrop-blur-[1px] xl:hidden" />}
      <aside className={`fixed bottom-0 right-0 top-16 z-40 flex w-[min(336px,92vw)] flex-col border-l border-[#dedede] bg-[#f8f8f8] p-4 shadow-[-12px_0_40px_rgba(0,0,0,.08)] transition-transform duration-200 xl:z-10 xl:shadow-none ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}>
        <div className="flex items-start justify-between">
          <div><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">计划池</h2><span className="rounded-full bg-[#e9e9e9] px-2 py-0.5 text-[9px] text-[#666]">{items.length} 待安排</span></div><p className="mt-1 text-[11px] text-[#777]">先收集想做的事，再拖到日历安排</p></div>
          <div className="flex gap-1"><button onClick={onCreate} aria-label="添加计划池事项" className="icon-button size-8"><CirclePlus className="size-3.5" /></button><button onClick={onClose} aria-label="关闭计划池" className="icon-button size-8 xl:hidden"><X className="size-3.5" /></button></div>
        </div>
        <div className="mt-4 grid grid-cols-2 rounded-lg border border-[#dedede] bg-[#eee] p-1 text-[11px] font-medium">
          {(['week', 'month'] as PoolScope[]).map((value) => <button key={value} onClick={() => setScope(value)} className={`rounded-md py-1.5 transition ${scope === value ? 'bg-white text-black shadow-sm' : 'text-[#777] hover:text-black'}`}>{value === 'week' ? '本周' : '本月'}</button>)}
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] text-[#888]"><span>进度 {scheduled}/{total}</span><span>拖动卡片到日历</span></div>

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
          {items.map((item) => (
            <article
              key={item.id}
              draggable
              onDragStart={(event) => onDragStart(event, { kind: 'pool', id: item.id })}
              onDragEnd={onDragEnd}
              onClick={() => onEdit(item)}
              className={`group cursor-grab rounded-lg border border-[#dedede] bg-white p-3 shadow-[0_1px_1px_rgba(0,0,0,.03)] transition hover:-translate-y-px hover:border-[#bbb] hover:shadow-sm active:cursor-grabbing ${dragging?.kind === 'pool' && dragging.id === item.id ? 'opacity-40' : ''}`}
            >
              <div className="flex items-start gap-2">
                <GripVertical className="mt-0.5 size-3.5 shrink-0 text-[#bbb] group-hover:text-[#777]" />
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${categoryMeta[item.category].dot}`} />
                <div className="min-w-0 flex-1"><p className="text-xs font-medium leading-5">{item.title}</p>{item.note && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#888]">{item.note}</p>}<div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[9px] text-[#666]">{durationLabel(item.duration)}</span><span className={`rounded px-1.5 py-0.5 text-[9px] ${priorityMeta[item.priority].className}`}>{priorityMeta[item.priority].label}</span></div></div>
              </div>
            </article>
          ))}
          {!items.length && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-[#d4d4d4] p-5 text-center"><div><CheckCircle2 className="mx-auto size-6 text-emerald-500" /><p className="mt-2 text-xs font-medium">都安排好了</p><p className="mt-1 text-[10px] text-[#888]">点击右上角 + 继续添加想做的事</p></div></div>}
        </div>

        <button onClick={onAutoSchedule} disabled={loading || !items.length} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-black px-3 py-2.5 text-xs font-medium text-white transition hover:bg-[#292929] disabled:cursor-not-allowed disabled:opacity-40">{loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{loading ? 'DeepSeek 排期中' : 'AI 自动排期'}</button>
        <div onDragOver={(event) => { if (dragging?.kind === 'plan') { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={onDropBack} className={`mt-3 rounded-lg border border-dashed p-3 text-center text-[10px] leading-5 transition ${dragging?.kind === 'plan' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-[#c8c8c8] text-[#888]'}`}>把日历计划拖到这里<br />取消排期并放回计划池</div>
      </aside>
    </>
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

function emptyPoolDraft(scope: PoolScope): PoolDraft {
  return { title: '', scope, duration: 60, priority: 'medium', category: 'work', note: '' };
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

function MonthView({ anchorDate, today, plans, onCreate, onEdit, onDrop, onDragStart, onDragEnd, dropTarget, setDropTarget }: { anchorDate: Date; today: Date; plans: Plan[]; onCreate: (date: Date) => void; onEdit: (plan: Plan) => void } & CalendarDragProps) {
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
          const targetId = `month-${toISO(day)}`;
          return (
            <div
              key={toISO(day)}
              onDoubleClick={() => onCreate(day)}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(targetId); }}
              onDrop={(event) => onDrop(event, day)}
              className={`group min-h-[132px] border-b border-r border-[#e7e7e7] p-2 last:border-r-0 ${outside ? 'bg-[#fafafa] text-[#aaa]' : 'bg-white'} ${isSameDay(day, today) ? 'bg-violet-50/30' : ''} ${dropTarget === targetId ? 'calendar-drop-active' : ''}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${isSameDay(day, today) ? 'bg-black text-white' : ''}`}>{day.getDate()}</span>
                <button onClick={() => onCreate(day)} aria-label={`${formatChineseDate(day)}新建计划`} className="grid size-6 place-items-center rounded-md text-[#888] opacity-0 hover:bg-[#eee] group-hover:opacity-100"><CirclePlus className="size-3.5" /></button>
              </div>
              <div className="space-y-1">
                {dayPlans.slice(0, 3).map((plan) => (
                  <button key={plan.id} draggable onDragStart={(event) => onDragStart(event, { kind: 'plan', id: plan.id })} onDragEnd={onDragEnd} onClick={() => onEdit(plan)} className={`block w-full cursor-grab truncate rounded px-1.5 py-1 text-left text-[10px] font-medium active:cursor-grabbing ${categoryMeta[plan.category].card}`}>
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

function WeekView({ days, today, plans, onCreate, onEdit, onDrop, onDragStart, onDragEnd, dropTarget, setDropTarget }: { days: Date[]; today: Date; plans: Plan[]; onCreate: (date: Date, time?: string) => void; onEdit: (plan: Plan) => void } & CalendarDragProps) {
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
          const targetId = `week-${toISO(day)}`;
          return (
            <div
              key={toISO(day)}
              className={`relative border-l border-[#e6e6e6] ${isSameDay(day, today) ? 'bg-violet-50/30' : ''} ${dropTarget === targetId ? 'calendar-drop-active' : ''}`}
              onDoubleClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const rawHour = 8 + Math.floor((event.clientY - rect.top) / 60);
                openCreateAt(onCreate, day, rawHour);
              }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(targetId); }}
              onDrop={(event) => onDrop(event, day, dropTimeFromPointer(event, event.currentTarget))}
            >
              {dayPlans.map((plan) => <TimelinePlan key={plan.id} plan={plan} onEdit={onEdit} onDragStart={onDragStart} onDragEnd={onDragEnd} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ day, today, plans, onCreate, onEdit, onDrop, onDragStart, onDragEnd, dropTarget, setDropTarget }: { day: Date; today: Date; plans: Plan[]; onCreate: (date: Date, time?: string) => void; onEdit: (plan: Plan) => void } & CalendarDragProps) {
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
          <div
            className={`relative border-l border-[#e6e6e6] ${dropTarget === `day-${toISO(day)}` ? 'calendar-drop-active' : ''}`}
            onDoubleClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openCreateAt(onCreate, day, 8 + Math.floor((event.clientY - rect.top) / 60));
            }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(`day-${toISO(day)}`); }}
            onDrop={(event) => onDrop(event, day, dropTimeFromPointer(event, event.currentTarget))}
          >
            {dayPlans.map((plan) => <TimelinePlan key={plan.id} plan={plan} onEdit={onEdit} onDragStart={onDragStart} onDragEnd={onDragEnd} wide />)}
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

function dropTimeFromPointer(event: ReactDragEvent, element: HTMLElement) {
  const offset = Math.max(0, event.clientY - element.getBoundingClientRect().top);
  const total = Math.min(20 * 60 + 45, 8 * 60 + Math.round(offset / 15) * 15);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function TimelinePlan({ plan, onEdit, onDragStart, onDragEnd, wide = false }: { plan: Plan; onEdit: (plan: Plan) => void; onDragStart: (event: ReactDragEvent, payload: DragPayload) => void; onDragEnd: () => void; wide?: boolean }) {
  const start = minutes(plan.startTime);
  const end = Math.max(start + 30, minutes(plan.endTime));
  const top = ((start - 8 * 60) / 60) * 60;
  const height = Math.max(36, ((end - start) / 60) * 60 - 3);
  if (top < -height || top > 780) return null;
  return (
    <button draggable onDragStart={(event) => onDragStart(event, { kind: 'plan', id: plan.id })} onDragEnd={onDragEnd} onClick={() => onEdit(plan)} className={`absolute left-1.5 right-1.5 z-10 cursor-grab overflow-hidden rounded-md border p-2 text-left shadow-sm transition hover:-translate-y-px hover:shadow-md active:cursor-grabbing ${categoryMeta[plan.category].card} ${wide ? 'max-w-2xl' : ''}`} style={{ top: Math.max(0, top), height }}>
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

function PoolModal({ draft, setDraft, editing, onSubmit, onClose, onDelete }: { draft: PoolDraft; setDraft: (draft: PoolDraft) => void; editing: boolean; onSubmit: (event: FormEvent) => void; onClose: () => void; onDelete: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={onSubmit} className="modal-card max-w-[520px]">
        <div className="flex items-center justify-between border-b border-[#e7e7e7] px-5 py-4"><div><h2 className="text-base font-semibold">{editing ? '编辑计划池事项' : '放入计划池'}</h2><p className="mt-0.5 text-[11px] text-[#777]">先记录意图，具体时间稍后再安排</p></div><button type="button" onClick={onClose} className="icon-button border-0"><X className="size-4" /></button></div>
        <div className="space-y-4 p-5">
          <label className="field-label">想做的事情<input autoFocus required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="field-input" placeholder="例如：准备产品发布材料" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="field-label">计划范围<select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as PoolScope })} className="field-input"><option value="week">本周</option><option value="month">本月</option></select></label>
            <label className="field-label">预计用时<select value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })} className="field-input"><option value={30}>30 分钟</option><option value={45}>45 分钟</option><option value={60}>1 小时</option><option value={90}>1.5 小时</option><option value={120}>2 小时</option><option value={180}>3 小时</option><option value={240}>4 小时</option></select></label>
            <label className="field-label">优先级<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })} className="field-input"><option value="high">高优先</option><option value="medium">中优先</option><option value="low">低优先</option></select></label>
            <label className="field-label">分类<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })} className="field-input">{(Object.keys(categoryMeta) as Category[]).map((category) => <option key={category} value={category}>{categoryMeta[category].label}</option>)}</select></label>
          </div>
          <label className="field-label">完成标准 / 备注<textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className="field-input min-h-24 resize-none" placeholder="AI 会参考这里的信息自动排期（可选）" /></label>
        </div>
        <div className="flex items-center border-t border-[#e7e7e7] px-5 py-4">{editing && <button type="button" onClick={onDelete} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"><Trash2 className="size-3.5" />删除</button>}<div className="ml-auto flex gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[#d8d8d8] px-4 py-2 text-xs font-medium">取消</button><button className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white">{editing ? '保存更改' : '放入计划池'}</button></div></div>
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
