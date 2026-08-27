import {
  Calendar1,
  CalendarDays,
  CalendarRange,
  BellRing,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Clock3,
  GripVertical,
  ImageDown,
  Inbox,
  LayoutGrid,
  ListTodo,
  LoaderCircle,
  Mail,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Timer as TimerIcon,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { toJpeg } from 'html-to-image';
import { CSSProperties, DragEvent as ReactDragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type ViewMode = 'month' | 'week' | 'day';
type Category = string;
type CategoryColor = 'violet' | 'sky' | 'emerald' | 'amber' | 'zinc';
type Section = 'calendar' | 'inbox' | 'completed';
type Source = 'manual' | 'ai' | 'quick';
type PoolScope = 'week' | 'month';
type Priority = 'high' | 'medium' | 'low';
type Theme = 'light' | 'dark';
type ExportKind = 'jpg' | 'ics';
type TimelineSettings = { startHour: number; endHour: number; hourHeight: number };
type CountdownStatus = 'idle' | 'running' | 'paused' | 'finished';
type CountdownTimer = { planId?: string; label: string; durationSeconds: number; remainingSeconds: number; endsAt?: string; status: CountdownStatus };
type CategoryDefinition = { id: string; label: string; color: CategoryColor };
type CategoryDisplay = { label: string; card: string; dot: string };
type CategoryDisplayMap = Record<string, CategoryDisplay>;

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

type PersistedState = {
  plans: Plan[];
  poolItems: PoolItem[];
  categories: CategoryDefinition[];
  settings: { theme: Theme; calendarWidth: number; timeline: TimelineSettings };
  timer: CountdownTimer;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const DRAG_MIME = 'application/x-kekaku-plan';
const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const monthWeekdays = ['一', '二', '三', '四', '五', '六', '日'];
const DEFAULT_TIMELINE: TimelineSettings = { startHour: 6, endHour: 23, hourHeight: 48 };
const DEFAULT_COUNTDOWN: CountdownTimer = { label: '专注计时', durationSeconds: 5 * 60, remainingSeconds: 5 * 60, status: 'idle' };
const TIMER_PRESETS = [5, 15, 25, 45, 60];

const categoryColorMeta: Record<CategoryColor, Omit<CategoryDisplay, 'label'>> = {
  violet: { card: 'plan-work', dot: 'bg-violet-500' },
  sky: { card: 'plan-study', dot: 'bg-sky-500' },
  emerald: { card: 'plan-health', dot: 'bg-emerald-500' },
  amber: { card: 'plan-life', dot: 'bg-amber-500' },
  zinc: { card: 'plan-other', dot: 'bg-zinc-500' },
};

const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  { id: 'personal', label: '个人', color: 'amber' },
  { id: 'work', label: '工作', color: 'violet' },
  { id: 'study', label: '学习', color: 'sky' },
];

const FALLBACK_CATEGORY: CategoryDisplay = { label: '个人', ...categoryColorMeta.amber };
const categoryColors = Object.keys(categoryColorMeta) as CategoryColor[];

const priorityMeta: Record<Priority, { label: string; className: string }> = {
  high: { label: '高优先', className: 'bg-red-50 text-red-700' },
  medium: { label: '中优先', className: 'bg-amber-50 text-amber-700' },
  low: { label: '低优先', className: 'bg-zinc-100 text-zinc-600' },
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function normalizeCountdown(value?: Partial<CountdownTimer>): CountdownTimer {
  const rawDuration = Number(value?.durationSeconds);
  const durationSeconds = Number.isFinite(rawDuration) ? Math.max(1, Math.min(359999, Math.round(rawDuration))) : DEFAULT_COUNTDOWN.durationSeconds;
  const rawRemaining = Number(value?.remainingSeconds);
  const status: CountdownStatus = value?.status === 'running' || value?.status === 'paused' || value?.status === 'finished' ? value.status : 'idle';
  const remainingSeconds = status === 'finished'
    ? 0
    : Number.isFinite(rawRemaining) ? Math.max(0, Math.min(durationSeconds, Math.round(rawRemaining))) : durationSeconds;
  const validEnd = status === 'running' && value?.endsAt && Number.isFinite(Date.parse(value.endsAt));
  return {
    planId: value?.planId?.trim() || undefined,
    label: value?.label?.trim() || DEFAULT_COUNTDOWN.label,
    durationSeconds,
    remainingSeconds: status === 'idle' && remainingSeconds === 0 ? durationSeconds : remainingSeconds,
    endsAt: validEnd ? value.endsAt : undefined,
    status: status === 'running' && !validEnd ? 'paused' : status,
  };
}

function countdownRemaining(timer: CountdownTimer, now: number) {
  if (timer.status !== 'running' || !timer.endsAt) return timer.remainingSeconds;
  return Math.max(0, Math.ceil((Date.parse(timer.endsAt) - now) / 1000));
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutesPart = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${pad(hours)}:${pad(minutesPart)}:${pad(seconds)}`;
}

function countdownDurationLabel(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return formatCountdown(seconds);
}

function planDurationSeconds(plan: Plan) {
  return Math.max(60, (minutes(plan.endTime) - minutes(plan.startTime)) * 60);
}

function normalizeTimelineSettings(value: Partial<TimelineSettings>): TimelineSettings {
  const rawStart = Number(value.startHour);
  const rawEnd = Number(value.endHour);
  const rawHeight = Number(value.hourHeight);
  const startHour = Number.isFinite(rawStart) ? Math.max(0, Math.min(22, Math.round(rawStart))) : DEFAULT_TIMELINE.startHour;
  const endHour = Number.isFinite(rawEnd) ? Math.max(startHour + 2, Math.min(24, Math.round(rawEnd))) : DEFAULT_TIMELINE.endHour;
  const hourHeight = Number.isFinite(rawHeight) ? Math.max(40, Math.min(72, Math.round(rawHeight / 4) * 4)) : DEFAULT_TIMELINE.hourHeight;
  return { startHour, endHour, hourHeight };
}

function normalizeCategories(value: unknown): CategoryDefinition[] {
  if (!Array.isArray(value)) return DEFAULT_CATEGORIES;
  const seen = new Set<string>();
  const normalized = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 80) : '';
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 12) : '';
    const color = categoryColors.includes(item.color as CategoryColor) ? item.color as CategoryColor : 'zinc';
    if (!id || !label || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label, color }];
  }).slice(0, 12);
  if (!normalized.some((category) => category.id === 'personal')) normalized.unshift(DEFAULT_CATEGORIES[0]);
  return normalized.length ? normalized : DEFAULT_CATEGORIES;
}

function buildCategoryDisplayMap(categories: CategoryDefinition[]): CategoryDisplayMap {
  return Object.fromEntries(categories.map((category) => [category.id, { label: category.label, ...categoryColorMeta[category.color] }]));
}

function categoryDisplay(map: CategoryDisplayMap, id: string): CategoryDisplay {
  return map[id] || FALLBACK_CATEGORY;
}

function migrateCategory(id: unknown, allowed: Set<string>) {
  if (typeof id === 'string' && allowed.has(id)) return id;
  return 'personal';
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

function currentViewRange(view: ViewMode, anchorDate: Date) {
  if (view === 'month') {
    const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
    return { start, end, label: `${anchorDate.getFullYear()}年${anchorDate.getMonth() + 1}月` };
  }
  if (view === 'week') {
    const start = startOfWeek(anchorDate);
    const end = addDays(start, 6);
    return { start, end, label: `${formatChineseDate(start)}–${formatChineseDate(end)}` };
  }
  const day = startOfDay(anchorDate);
  return { start: day, end: day, label: `${anchorDate.getFullYear()}年${formatChineseDate(day)}` };
}

function downloadFile(content: Blob | string, filename: string) {
  const href = typeof content === 'string' ? content : URL.createObjectURL(content);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (content instanceof Blob) window.setTimeout(() => URL.revokeObjectURL(href), 1000);
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
      category: 'personal',
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
      category: 'personal',
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
    { id: 'pool-3', title: '整理旅行照片', scope: 'month', duration: 90, priority: 'low', category: 'personal', note: '筛选、归档并挑选 20 张', scheduled: false },
    { id: 'pool-4', title: '安排一次长距离慢跑', scope: 'month', duration: 90, priority: 'medium', category: 'personal', note: '选择天气合适的周末上午', scheduled: false },
  ];
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
  const [theme, setTheme] = useState<Theme>('light');
  const [calendarWidth, setCalendarWidth] = useState(100);
  const [timelineSettings, setTimelineSettings] = useState<TimelineSettings>(DEFAULT_TIMELINE);
  const [categories, setCategories] = useState<CategoryDefinition[]>(DEFAULT_CATEGORIES);
  const [hydrated, setHydrated] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
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
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [icsEmailOpen, setIcsEmailOpen] = useState(false);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [icsEmailError, setIcsEmailError] = useState('');
  const [countdown, setCountdown] = useState<CountdownTimer>(DEFAULT_COUNTDOWN);
  const [timerOpen, setTimerOpen] = useState(false);
  const [timerExpanded, setTimerExpanded] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const plannerExportRef = useRef<HTMLDivElement>(null);
  const timerAudioRef = useRef<AudioContext | null>(null);

  /* Persisted application state is hydrated from the Go API after mount. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void fetch(`${API_BASE}/api/state`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('state unavailable');
        return await response.json() as PersistedState;
      })
      .then((state) => {
        const nextCategories = normalizeCategories(state.categories);
        const allowedCategoryIds = new Set(nextCategories.map((category) => category.id));
        const nextTheme: Theme = state.settings?.theme === 'dark' ? 'dark' : 'light';
        setCategories(nextCategories);
        setPlans((state.plans || []).map((plan) => ({ ...plan, category: migrateCategory(plan.category, allowedCategoryIds) })));
        setPoolItems((state.poolItems || []).map((item) => ({ ...item, category: migrateCategory(item.category, allowedCategoryIds) })));
        setTheme(nextTheme);
        setCalendarWidth(Math.max(70, Math.min(100, Number(state.settings?.calendarWidth) || 100)));
        setTimelineSettings(normalizeTimelineSettings(state.settings?.timeline || DEFAULT_TIMELINE));
        const restoredTimer = normalizeCountdown(state.timer);
        setCountdown(restoredTimer);
        setTimerOpen(restoredTimer.status !== 'idle');
        document.documentElement.dataset.theme = nextTheme;
        document.documentElement.style.colorScheme = nextTheme;
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setPlans(createSamplePlans(new Date()));
        setPoolItems(createSamplePool());
        setToast('暂时无法连接 Go 服务，当前改动不会保存');
      })
      .finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; controller.abort(); };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const state: PersistedState = { plans, poolItems, categories, settings: { theme, calendarWidth, timeline: timelineSettings }, timer: countdown };
      void fetch(`${API_BASE}/api/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error('save failed');
      }).catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setToast('保存失败，请检查 Go 服务');
      });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [calendarWidth, categories, countdown, hydrated, plans, poolItems, theme, timelineSettings]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const remainingTime = countdownRemaining(countdown, clockNow);

  useEffect(() => {
    if (countdown.status !== 'running') return;
    setClockNow(Date.now());
    const ticker = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(ticker);
  }, [countdown.endsAt, countdown.status]);

  useEffect(() => {
    if (countdown.status !== 'running' || remainingTime > 0) return;
    setCountdown((current) => current.status === 'running' ? { ...current, status: 'finished', remainingSeconds: 0, endsAt: undefined } : current);
    setTimerOpen(true);
    setTimerExpanded(false);
    setToast(`${countdown.label} · 倒计时结束`);
    const audio = timerAudioRef.current;
    if (audio) {
      void audio.resume().then(() => {
        [0, 0.22].forEach((delay, index) => {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.frequency.value = index === 0 ? 880 : 1046;
          gain.gain.setValueAtTime(0.0001, audio.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + delay + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + delay + 0.2);
          oscillator.connect(gain).connect(audio.destination);
          oscillator.start(audio.currentTime + delay);
          oscillator.stop(audio.currentTime + delay + 0.22);
        });
      }).catch(() => undefined);
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Kekaku 倒计时结束', { body: countdown.label });
    }
  }, [countdown.label, countdown.status, remainingTime]);

  useEffect(() => {
    const defaultTitle = 'Kekaku · 我的计划';
    document.title = countdown.status === 'running' || countdown.status === 'paused'
      ? `${formatCountdown(remainingTime)} · ${countdown.label}`
      : defaultTitle;
    return () => { document.title = defaultTitle; };
  }, [countdown.label, countdown.status, remainingTime]);

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
  const categoryMeta = useMemo(() => buildCategoryDisplayMap(categories), [categories]);

  const weekStart = startOfWeek(anchorDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const openCreate = (date = anchorDate, startTime = '09:00') => {
    const start = minutes(startTime);
    setEditingId(null);
    setDraft({
      ...emptyDraft(date, categories.some((category) => category.id === 'work') ? 'work' : 'personal'),
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

  const primeTimerAudio = () => {
    try {
      if (!timerAudioRef.current) timerAudioRef.current = new AudioContext();
      void timerAudioRef.current.resume();
    } catch {
      // The visual completion state still works when audio is unavailable.
    }
  };

  const startOrResumeTimer = () => {
    primeTimerAudio();
    const seconds = countdown.status === 'paused' && countdown.remainingSeconds > 0
      ? countdown.remainingSeconds
      : countdown.durationSeconds;
    setClockNow(Date.now());
    setCountdown((current) => ({ ...current, remainingSeconds: seconds, endsAt: new Date(Date.now() + seconds * 1000).toISOString(), status: 'running' }));
    setTimerOpen(true);
  };

  const pauseTimer = () => {
    const seconds = countdownRemaining(countdown, Date.now());
    setCountdown((current) => ({ ...current, remainingSeconds: seconds, endsAt: undefined, status: 'paused' }));
  };

  const resetTimer = () => {
    setCountdown((current) => ({ ...current, remainingSeconds: current.durationSeconds, endsAt: undefined, status: 'idle' }));
    setClockNow(Date.now());
  };

  const setTimerDuration = (seconds: number) => {
    if (countdown.status === 'running') return;
    const durationSeconds = Math.max(1, Math.min(359999, Math.round(seconds)));
    setCountdown((current) => ({ ...current, durationSeconds, remainingSeconds: durationSeconds, endsAt: undefined, status: 'idle' }));
  };

  const bindTimerPlan = (planId: string) => {
    if (countdown.status === 'running') return;
    const plan = plans.find((item) => item.id === planId);
    if (!plan) {
      setCountdown((current) => ({ ...current, planId: undefined, label: '专注计时', remainingSeconds: current.durationSeconds, status: 'idle', endsAt: undefined }));
      return;
    }
    const durationSeconds = planDurationSeconds(plan);
    setCountdown({ planId: plan.id, label: plan.title, durationSeconds, remainingSeconds: durationSeconds, status: 'idle' });
  };

  const startPlanTimer = (plan: Plan) => {
    primeTimerAudio();
    const durationSeconds = planDurationSeconds(plan);
    setClockNow(Date.now());
    setCountdown({ planId: plan.id, label: plan.title, durationSeconds, remainingSeconds: durationSeconds, endsAt: new Date(Date.now() + durationSeconds * 1000).toISOString(), status: 'running' });
    setTimerOpen(true);
    setTimerExpanded(false);
    setPlanModalOpen(false);
    setToast(`已开始 · ${plan.title}`);
  };

  const completeTimerPlan = () => {
    if (!countdown.planId) return;
    setPlans((current) => current.map((plan) => plan.id === countdown.planId ? { ...plan, completed: true } : plan));
    setToast(`${countdown.label} · 已标记完成`);
  };

  const openPoolCreate = () => {
    setPoolEditingId(null);
    setPoolDraft(emptyPoolDraft(poolScope, categories.some((category) => category.id === 'work') ? 'work' : 'personal'));
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
    setCountdown((current) => current.planId === editingId ? { ...current, planId: undefined } : current);
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
      const now = new Date();
      const existing = activePlans
        .filter((plan) => plan.date >= toISO(today))
        .slice(0, 100)
        .map(({ title, date, startTime, endTime }) => ({ title, date, startTime, endTime }));
      const response = await fetch(`${API_BASE}/api/ai-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          today: toISO(today),
          currentTime: `${toISO(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          categories: categories.map(({ id, label }) => ({ id, label })),
          existingPlans: existing,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'AI 制定暂时不可用，请稍后重试');
      }
      const result = (await response.json()) as { schemaVersion?: string; summary?: string; plans?: PlanDraft[] };
      if (result.schemaVersion !== '1.0') throw new Error('AI 返回的数据格式版本不正确，请重试');
      if (!result.plans?.length) throw new Error('DeepSeek 没有生成可用计划，请换一种描述后重试');
      setAiPreview({
        summary: result.summary || 'DeepSeek 已把你的目标拆成可执行计划。',
        plans: result.plans,
        source: 'ai',
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'AI 制定暂时不可用，请稍后重试');
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
      const response = await fetch(`${API_BASE}/api/ai-schedule`, {
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

  const toggleTheme = () => {
    setTheme((current) => {
      const next: Theme = current === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      return next;
    });
  };

  const updateCalendarWidth = (value: number) => {
    const next = Math.max(70, Math.min(100, Math.round(value / 5) * 5));
    setCalendarWidth(next);
  };

  const updateTimelineSettings = (patch: Partial<TimelineSettings>) => {
    setTimelineSettings((current) => {
      const next = normalizeTimelineSettings({ ...current, ...patch });
      return next;
    });
  };

  const saveCategories = (nextCategories: CategoryDefinition[]) => {
    const normalized = normalizeCategories(nextCategories);
    const allowed = new Set(normalized.map((category) => category.id));
    const keepCategory = (category: string) => allowed.has(category) ? category : 'personal';
    setCategories(normalized);
    setPlans((current) => current.map((plan) => ({ ...plan, category: keepCategory(plan.category) })));
    setPoolItems((current) => current.map((item) => ({ ...item, category: keepCategory(item.category) })));
    setDraft((current) => ({ ...current, category: keepCategory(current.category) }));
    setPoolDraft((current) => ({ ...current, category: keepCategory(current.category) }));
    setAiPreview((current) => current ? { ...current, plans: current.plans.map((plan) => ({ ...plan, category: keepCategory(plan.category) })) } : null);
    setCategoryModalOpen(false);
    setToast('分类已更新');
  };

  const exportCurrentJPG = async () => {
    const node = plannerExportRef.current;
    if (!node || exporting) return;
    setExporting('jpg');
    node.classList.add('is-exporting-jpg');
    try {
      await document.fonts.ready;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      const calendar = node.querySelector<HTMLElement>('.calendar-export-card');
      const width = Math.ceil(Math.max(node.scrollWidth, calendar?.scrollWidth || 0, node.getBoundingClientRect().width));
      const height = Math.ceil(Math.max(node.scrollHeight, (calendar?.scrollHeight || 0) + 72, node.getBoundingClientRect().height));
      const range = currentViewRange(view, anchorDate);
      const dataURL = await toJpeg(node, {
        quality: 0.98,
        pixelRatio: 2.5,
        cacheBust: true,
        backgroundColor: theme === 'dark' ? '#101010' : '#ffffff',
        width,
        height,
        style: { width: `${width}px`, maxWidth: 'none', overflow: 'visible' },
        filter: (target) => !(target instanceof HTMLElement && target.dataset.exportIgnore === 'true'),
      });
      downloadFile(dataURL, `kekaku-${view}-${toISO(range.start)}-${toISO(range.end)}.jpg`);
      setToast('当前日历计划已导出为高清 JPG');
    } catch {
      setToast('JPG 导出失败，请稍后重试');
    } finally {
      node.classList.remove('is-exporting-jpg');
      setExporting(null);
    }
  };

  const openICSEmail = () => {
    if (exporting) return;
    if (!plans.length) {
      setToast('日历里还没有可以发送的计划');
      return;
    }
    setIcsEmailError('');
    setIcsEmailOpen(true);
  };

  const closeICSEmail = () => {
    if (exporting === 'ics') return;
    setSmtpPassword('');
    setIcsEmailError('');
    setIcsEmailOpen(false);
  };

  const sendICSEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (exporting || !smtpPassword.trim()) return;
    setExporting('ics');
    setIcsEmailError('');
    try {
      const response = await fetch(`${API_BASE}/api/calendar/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smtpPassword: smtpPassword.trim(), confirmed: true }),
      });
      const result = await response.json().catch(() => null) as { error?: string; plans?: number; recipient?: string } | null;
      if (!response.ok) throw new Error(result?.error || '日历邮件发送失败');
      setSmtpPassword('');
      setIcsEmailOpen(false);
      setToast(`已将 ${result?.plans || plans.length} 条计划发送到 ${result?.recipient || 'bluecat16384@163.com'}`);
    } catch (error) {
      setIcsEmailError(error instanceof Error ? error.message : '日历邮件发送失败');
    } finally {
      setExporting(null);
    }
  };

  const exportRange = currentViewRange(view, anchorDate);
  const exportPlanCount = plans.filter((plan) => plan.date >= toISO(exportRange.start) && plan.date <= toISO(exportRange.end)).length;
  const title = section === 'calendar' ? '我的计划' : section === 'inbox' ? '快捷收集箱' : '已完成';

  return (
    <main className="min-h-screen bg-white text-[#202020]">
      <Sidebar
        section={section}
        setSection={setSection}
        categories={categories}
        categoryMeta={categoryMeta}
        inboxCount={inboxPlans.length}
        completedCount={completedPlans.length}
        onCreate={() => openCreate()}
        onManageCategories={() => setCategoryModalOpen(true)}
      />

      <section className="min-h-screen md:pl-[224px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#e4e4e4] bg-white/95 px-4 backdrop-blur md:px-7">
          <div>
            <h1 className="text-base font-semibold md:text-lg">{title}</h1>
            <p className="hidden text-xs text-[#777] sm:block">
              {section === 'calendar' ? '把重要的事，放进真实的时间里' : section === 'inbox' ? '快速捕捉，再从容安排' : '每一次完成都值得看见'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTimerOpen((open) => !open)}
              aria-pressed={timerOpen}
              aria-label="打开倒计时器"
              title="计划倒计时"
              className={`timer-toggle-button ${countdown.status === 'running' ? 'is-running' : ''}`}
            >
              <TimerIcon className="size-4" />
              <span className="hidden lg:inline">{countdown.status === 'running' || countdown.status === 'paused' ? formatCountdown(remainingTime) : '计时器'}</span>
            </button>
            <button onClick={() => setCategoryModalOpen(true)} aria-label="管理分类" title="分类管理" className="icon-button shrink-0">
              <Settings2 className="size-4" />
            </button>
            <button onClick={toggleTheme} aria-label={theme === 'light' ? '切换到黑色主题' : '切换到浅色主题'} title={theme === 'light' ? '黑色主题' : '浅色主题'} className="icon-button shrink-0">
              {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </button>
            {section === 'calendar' && (
              <>
              <CalendarLayoutControl width={calendarWidth} timeline={timelineSettings} onWidthChange={updateCalendarWidth} onTimelineChange={updateTimelineSettings} />
              <button onClick={() => setPoolOpen((open) => !open)} aria-pressed={poolOpen} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition ${poolOpen ? 'border-black bg-black text-white' : 'border-[#dedede] bg-white hover:bg-[#f6f6f6]'}`}>
                <ListTodo className="size-3.5" /><span className="hidden sm:inline">AI / 计划池</span><span className="rounded-full bg-white/15 px-1.5 text-[9px]">{visiblePoolItems.length}</span>
              </button>
              <ViewSwitch value={view} onChange={setView} />
              </>
            )}
          </div>
        </header>

        <div
          className={`${section === 'calendar' ? 'planner-layout-shell' : 'mx-auto max-w-[1500px]'} p-4 md:p-7 ${section === 'calendar' && poolOpen ? 'xl:pr-[380px]' : ''}`}
          style={section === 'calendar' ? { '--calendar-width': `${calendarWidth}%` } as CSSProperties : undefined}
        >
          {section === 'calendar' ? (
            <>
              <PlannerToolbar
                view={view}
                anchorDate={anchorDate}
                weekStart={weekStart}
                onPrevious={() => shiftDate(-1)}
                onNext={() => shiftDate(1)}
                onToday={() => setAnchorDate(startOfDay(new Date()))}
                exporting={exporting}
                onExportJPG={exportCurrentJPG}
                onExportICS={openICSEmail}
              />

              <div ref={plannerExportRef} className="calendar-export-surface">
                <div className="calendar-export-title">
                  <div><p className="text-lg font-semibold">{exportRange.label} · {view === 'month' ? '月计划' : view === 'week' ? '周计划' : '日计划'}</p><p className="mt-1 text-xs text-[#777]">Kekaku · 共 {exportPlanCount} 项计划</p></div>
                  <CalendarDays className="size-5 text-[#777]" />
                </div>
                {view === 'month' && (
                  <MonthView
                    anchorDate={anchorDate}
                    today={today}
                    plans={plans}
                    categoryMeta={categoryMeta}
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
                    plans={plans}
                    categoryMeta={categoryMeta}
                    timeline={timelineSettings}
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
                    plans={plans}
                    categoryMeta={categoryMeta}
                    timeline={timelineSettings}
                    onCreate={openCreate}
                    onEdit={openEdit}
                    onDrop={dropOnCalendar}
                    onDragStart={startDragging}
                    onDragEnd={finishDragging}
                    dropTarget={dropTarget}
                    setDropTarget={setDropTarget}
                  />
                )}
              </div>
            </>
          ) : (
            <PlanList
              plans={section === 'inbox' ? inboxPlans : completedPlans}
              categoryMeta={categoryMeta}
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
          categoryMeta={categoryMeta}
          allItems={poolItems}
          quickPrompt={quickPrompt}
          setQuickPrompt={setQuickPrompt}
          aiPlanLoading={aiLoading}
          scheduleLoading={poolAiLoading}
          dragging={dragging}
          onClose={() => setPoolOpen(false)}
          onCreate={openPoolCreate}
          onEdit={openPoolEdit}
          onAiSubmit={submitQuickPlan}
          onAutoSchedule={autoSchedulePool}
          onDragStart={startDragging}
          onDragEnd={finishDragging}
          onDropBack={dropBackToPool}
        />
      )}

      {timerOpen && (
        <CountdownWidget
          timer={countdown}
          remaining={remainingTime}
          plans={activePlans}
          expanded={timerExpanded}
          offsetForPool={section === 'calendar' && poolOpen}
          onClose={() => { setTimerOpen(false); setTimerExpanded(false); }}
          onToggleExpanded={() => setTimerExpanded((expanded) => !expanded)}
          onBindPlan={bindTimerPlan}
          onDurationChange={setTimerDuration}
          onStart={startOrResumeTimer}
          onPause={pauseTimer}
          onReset={resetTimer}
          onCompletePlan={completeTimerPlan}
        />
      )}

      {planModalOpen && (
        <PlanModal
          draft={draft}
          setDraft={setDraft}
          categories={categories}
          editing={Boolean(editingId)}
          completed={editingId ? Boolean(plans.find((plan) => plan.id === editingId)?.completed) : false}
          plan={editingId ? plans.find((plan) => plan.id === editingId) : undefined}
          onSubmit={savePlan}
          onClose={() => setPlanModalOpen(false)}
          onDelete={deleteEditingPlan}
          onToggleCompleted={() => editingId && toggleCompleted(editingId)}
          onStartTimer={startPlanTimer}
        />
      )}

      {poolModalOpen && (
        <PoolModal
          draft={poolDraft}
          setDraft={setPoolDraft}
          categories={categories}
          editing={Boolean(poolEditingId)}
          onSubmit={savePoolItem}
          onClose={() => setPoolModalOpen(false)}
          onDelete={deletePoolItem}
        />
      )}

      {aiPreview && (
        <AiPreviewModal preview={aiPreview} categoryMeta={categoryMeta} onClose={() => setAiPreview(null)} onAdd={addAiPlans} />
      )}

      {icsEmailOpen && (
        <IcsEmailModal
          plans={plans}
          smtpPassword={smtpPassword}
          setSmtpPassword={setSmtpPassword}
          error={icsEmailError}
          sending={exporting === 'ics'}
          onSubmit={sendICSEmail}
          onClose={closeICSEmail}
        />
      )}

      {categoryModalOpen && (
        <CategoryManagerModal categories={categories} onClose={() => setCategoryModalOpen(false)} onSave={saveCategories} />
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
  categoryMeta,
  allItems,
  quickPrompt,
  setQuickPrompt,
  aiPlanLoading,
  scheduleLoading,
  dragging,
  onClose,
  onCreate,
  onEdit,
  onAiSubmit,
  onAutoSchedule,
  onDragStart,
  onDragEnd,
  onDropBack,
}: {
  open: boolean;
  scope: PoolScope;
  setScope: (scope: PoolScope) => void;
  items: PoolItem[];
  categoryMeta: CategoryDisplayMap;
  allItems: PoolItem[];
  quickPrompt: string;
  setQuickPrompt: (value: string) => void;
  aiPlanLoading: boolean;
  scheduleLoading: boolean;
  dragging: DragPayload | null;
  onClose: () => void;
  onCreate: () => void;
  onEdit: (item: PoolItem) => void;
  onAiSubmit: (event: FormEvent) => void;
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
      <aside className={`fixed bottom-0 right-0 top-16 z-40 flex w-[min(360px,94vw)] flex-col border-l border-[#dedede] bg-[#f8f8f8] p-4 shadow-[-12px_0_40px_rgba(0,0,0,.08)] transition-transform duration-200 xl:z-10 xl:shadow-none ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}>
        <div className="flex items-start justify-between">
          <div><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">计划工作区</h2><span className="rounded-full bg-[#e9e9e9] px-2 py-0.5 text-[9px] text-[#666]">{items.length} 待安排</span></div><p className="mt-1 text-[11px] text-[#777]">用 AI 制定，或从计划池拖动安排</p></div>
          <div className="flex gap-1"><button onClick={onCreate} aria-label="添加计划池事项" className="icon-button size-8"><CirclePlus className="size-3.5" /></button><button onClick={onClose} aria-label="关闭计划池" className="icon-button size-8 xl:hidden"><X className="size-3.5" /></button></div>
        </div>

        <form onSubmit={onAiSubmit} className="mt-4 rounded-xl border border-[#d8d8d8] bg-white p-3 shadow-[0_1px_1px_rgba(0,0,0,.03)] focus-within:border-[#999]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold"><span className="grid size-7 place-items-center rounded-lg bg-violet-50 text-violet-700"><WandSparkles className="size-3.5" /></span>AI 制定计划</div>
            <span className="text-[9px] font-medium text-[#999]">DeepSeek</span>
          </div>
          <textarea
            value={quickPrompt}
            onChange={(event) => setQuickPrompt(event.target.value)}
            rows={3}
            maxLength={1000}
            className="mt-3 w-full resize-none rounded-lg border border-[#e1e1e1] bg-[#fafafa] px-3 py-2.5 text-xs leading-5 outline-none transition placeholder:text-[#aaa] focus:border-[#aaa] focus:bg-white"
            placeholder="例如：今晚下班后看两集动漫，上 2 小时英语课，再练 1 小时钢琴"
            aria-label="向 DeepSeek 描述要制定的计划"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[9px] leading-4 text-[#999]">会拆成独立任务，并避开已有日程</p>
            <button disabled={!quickPrompt.trim() || aiPlanLoading} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-[11px] font-medium text-white transition hover:bg-[#292929] disabled:cursor-not-allowed disabled:opacity-40">
              {aiPlanLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {aiPlanLoading ? '制定中' : '生成计划'}
            </button>
          </div>
        </form>

        <div className="mt-4 flex items-center justify-between"><p className="text-[11px] font-semibold">计划池</p><p className="text-[9px] text-[#999]">点击 + 添加事项</p></div>
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
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${categoryDisplay(categoryMeta, item.category).dot}`} />
                <div className="min-w-0 flex-1"><p className="text-xs font-medium leading-5">{item.title}</p>{item.note && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#888]">{item.note}</p>}<div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[9px] text-[#666]">{durationLabel(item.duration)}</span><span className={`rounded px-1.5 py-0.5 text-[9px] ${priorityMeta[item.priority].className}`}>{priorityMeta[item.priority].label}</span></div></div>
              </div>
            </article>
          ))}
          {!items.length && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-[#d4d4d4] p-5 text-center"><div><CheckCircle2 className="mx-auto size-6 text-emerald-500" /><p className="mt-2 text-xs font-medium">都安排好了</p><p className="mt-1 text-[10px] text-[#888]">点击右上角 + 继续添加想做的事</p></div></div>}
        </div>

        <button onClick={onAutoSchedule} disabled={scheduleLoading || !items.length} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-black px-3 py-2.5 text-xs font-medium text-white transition hover:bg-[#292929] disabled:cursor-not-allowed disabled:opacity-40">{scheduleLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{scheduleLoading ? 'DeepSeek 排期中' : 'AI 自动排期'}</button>
        <div onDragOver={(event) => { if (dragging?.kind === 'plan') { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={onDropBack} className={`mt-3 rounded-lg border border-dashed p-3 text-center text-[10px] leading-5 transition ${dragging?.kind === 'plan' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-[#c8c8c8] text-[#888]'}`}>把日历计划拖到这里<br />取消排期并放回计划池</div>
      </aside>
    </>
  );
}

function emptyDraft(date: Date, category = 'work'): PlanDraft {
  return {
    title: '',
    date: toISO(date),
    startTime: '09:00',
    endTime: '10:00',
    category,
    note: '',
  };
}

function emptyPoolDraft(scope: PoolScope, category = 'work'): PoolDraft {
  return { title: '', scope, duration: 60, priority: 'medium', category, note: '' };
}

function Sidebar({
  section,
  setSection,
  categories,
  categoryMeta,
  inboxCount,
  completedCount,
  onCreate,
  onManageCategories,
}: {
  section: Section;
  setSection: (section: Section) => void;
  categories: CategoryDefinition[];
  categoryMeta: CategoryDisplayMap;
  inboxCount: number;
  completedCount: number;
  onCreate: () => void;
  onManageCategories: () => void;
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

      <div className="mt-7 flex items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-[.12em] text-[#999]"><span>分类</span><button onClick={onManageCategories} aria-label="管理分类" className="rounded p-1 transition hover:bg-[#e9e9e9] hover:text-[#555]"><Settings2 className="size-3" /></button></div>
      <div className="mt-2 space-y-2 px-3">
        {categories.map((category) => (
          <div key={category.id} className="flex items-center gap-2 text-xs text-[#666]">
            <span className={`size-2 rounded-full ${categoryDisplay(categoryMeta, category.id).dot}`} /> {category.label}
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
    <button onClick={onClick} aria-pressed={active} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left font-medium transition ${active ? 'bg-[#e9e9e9] text-[#202020]' : 'text-[#666] hover:bg-[#ededed]'}`}>
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

function CalendarLayoutControl({ width, timeline, onWidthChange, onTimelineChange }: { width: number; timeline: TimelineSettings; onWidthChange: (value: number) => void; onTimelineChange: (patch: Partial<TimelineSettings>) => void }) {
  const [open, setOpen] = useState(false);
  const widthPresets = [
    { value: 75, label: '紧凑' },
    { value: 90, label: '舒适' },
    { value: 100, label: '铺满' },
  ];
  const timePresets = [
    { startHour: 8, endHour: 20, label: '08–20' },
    { startHour: 6, endHour: 23, label: '06–23' },
    { startHour: 0, endHour: 24, label: '全天' },
  ];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="calendar-layout-panel"
        title="调整日历宽度、时段和高度"
        className="flex h-[34px] items-center gap-1.5 rounded-lg border border-[#dedede] bg-white px-2.5 text-xs font-medium transition hover:bg-[#f6f6f6]"
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="hidden lg:inline">布局</span>
      </button>
      {open && (
        <div id="calendar-layout-panel" className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-[#dedede] bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div><p className="text-xs font-semibold">日历布局</p><p className="mt-1 text-[10px] text-[#777]">设置会自动保存在当前设备</p></div>
            <span className="rounded-md bg-[#f2f2f2] px-2 py-1 text-xs font-semibold tabular-nums">{pad(timeline.startHour)}–{pad(timeline.endHour)}</span>
          </div>
          <div className="mt-4 flex items-center justify-between"><label className="text-[11px] font-medium" htmlFor="calendar-width-range">占用宽度</label><span className="text-[10px] tabular-nums text-[#777]">{width}%</span></div>
          <input
            id="calendar-width-range"
            type="range"
            min="70"
            max="100"
            step="5"
            value={width}
            onChange={(event) => onWidthChange(Number(event.target.value))}
            className="calendar-range mt-2 w-full"
          />
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {widthPresets.map((preset) => (
              <button key={preset.value} onClick={() => onWidthChange(preset.value)} className={`rounded-md border px-2 py-1.5 text-[10px] font-medium transition ${width === preset.value ? 'border-black bg-black text-white' : 'border-[#dedede] hover:bg-[#f6f6f6]'}`}>
                {preset.label} {preset.value}%
              </button>
            ))}
          </div>
          <div className="my-4 border-t border-[#ececec]" />
          <div className="flex items-center justify-between"><p className="text-[11px] font-medium">显示时段</p><span className="text-[10px] text-[#777]">周 / 日视图</span></div>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <select value={timeline.startHour} onChange={(event) => onTimelineChange({ startHour: Number(event.target.value) })} aria-label="日历开始小时" className="field-input py-2 text-center tabular-nums">
              {Array.from({ length: timeline.endHour - 1 }, (_, hour) => hour).map((hour) => <option key={hour} value={hour}>{pad(hour)}:00</option>)}
            </select>
            <span className="text-xs text-[#888]">至</span>
            <select value={timeline.endHour} onChange={(event) => onTimelineChange({ endHour: Number(event.target.value) })} aria-label="日历结束小时" className="field-input py-2 text-center tabular-nums">
              {Array.from({ length: 24 - timeline.startHour - 1 }, (_, index) => timeline.startHour + index + 2).map((hour) => <option key={hour} value={hour}>{pad(hour)}:00</option>)}
            </select>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {timePresets.map((preset) => {
              const active = timeline.startHour === preset.startHour && timeline.endHour === preset.endHour;
              return <button key={preset.label} onClick={() => onTimelineChange({ startHour: preset.startHour, endHour: preset.endHour })} className={`rounded-md border px-2 py-1.5 text-[10px] font-medium transition ${active ? 'border-black bg-black text-white' : 'border-[#dedede] hover:bg-[#f6f6f6]'}`}>{preset.label}</button>;
            })}
          </div>
          <div className="mt-4 flex items-center justify-between"><label className="text-[11px] font-medium" htmlFor="calendar-height-range">每小时高度</label><span className="text-[10px] tabular-nums text-[#777]">{timeline.hourHeight}px</span></div>
          <input id="calendar-height-range" type="range" min="40" max="72" step="4" value={timeline.hourHeight} onChange={(event) => onTimelineChange({ hourHeight: Number(event.target.value) })} className="calendar-range mt-2 w-full" />
          <div className="mt-1 flex justify-between text-[9px] text-[#888]"><span>紧凑</span><span>宽松</span></div>
        </div>
      )}
    </div>
  );
}

function PlannerToolbar({
  view,
  anchorDate,
  weekStart,
  onPrevious,
  onNext,
  onToday,
  exporting,
  onExportJPG,
  onExportICS,
}: {
  view: ViewMode;
  anchorDate: Date;
  weekStart: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  exporting: ExportKind | null;
  onExportJPG: () => void;
  onExportICS: () => void;
}) {
  const rangeTitle = view === 'month'
    ? `${anchorDate.getFullYear()}年 ${anchorDate.getMonth() + 1}月`
    : view === 'week'
      ? `${weekStart.getFullYear()}年 ${formatChineseDate(weekStart)}–${formatChineseDate(addDays(weekStart, 6))}`
      : `${anchorDate.getFullYear()}年 ${formatChineseDate(anchorDate)} · ${weekdayNames[(anchorDate.getDay() + 6) % 7]}`;

  return (
    <div className="mb-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <button onClick={onPrevious} aria-label="上一段时间" className="icon-button"><ChevronLeft className="size-4" /></button>
          <button onClick={onNext} aria-label="下一段时间" className="icon-button"><ChevronRight className="size-4" /></button>
          <button onClick={onToday} className="ml-1 rounded-md border border-[#dedede] px-3 py-2 text-xs font-medium hover:bg-[#f6f6f6]">今天</button>
          <h2 className="ml-1 text-base font-semibold sm:text-lg">{rangeTitle}</h2>
        </div>
        <div data-export-ignore="true" className="flex shrink-0 items-center gap-2">
          <button onClick={onExportJPG} disabled={Boolean(exporting)} className="export-button" title="把当前月、周或日的日历计划内容保存为 JPG">
            {exporting === 'jpg' ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImageDown className="size-3.5" />}
            {exporting === 'jpg' ? '生成中' : '导出 JPG'}
          </button>
          <button onClick={onExportICS} disabled={Boolean(exporting)} className="export-button" title="把全部日历计划作为 iPhone 兼容 ICS 附件发送到邮箱">
            {exporting === 'ics' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
            {exporting === 'ics' ? '发送中' : '邮件 ICS'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MonthView({ anchorDate, today, plans, categoryMeta, onCreate, onEdit, onDrop, onDragStart, onDragEnd, dropTarget, setDropTarget }: { anchorDate: Date; today: Date; plans: Plan[]; categoryMeta: CategoryDisplayMap; onCreate: (date: Date) => void; onEdit: (plan: Plan) => void } & CalendarDragProps) {
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  return (
    <div className="calendar-export-card overflow-auto rounded-xl border border-[#dedede] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04)]">
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
                <button data-export-ignore="true" onClick={() => onCreate(day)} aria-label={`${formatChineseDate(day)}新建计划`} className="grid size-6 place-items-center rounded-md text-[#888] opacity-0 hover:bg-[#eee] group-hover:opacity-100"><CirclePlus className="size-3.5" /></button>
              </div>
              <div className="space-y-1">
                {dayPlans.map((plan, index) => (
                  <button key={plan.id} draggable onDragStart={(event) => onDragStart(event, { kind: 'plan', id: plan.id })} onDragEnd={onDragEnd} onClick={() => onEdit(plan)} className={`month-plan-item block w-full cursor-grab truncate rounded px-1.5 py-1 text-left text-[10px] font-medium active:cursor-grabbing ${index >= 3 ? 'month-plan-overflow' : ''} ${categoryDisplay(categoryMeta, plan.category).card} ${plan.completed ? 'plan-completed' : ''}`}>
                    <span className="mr-1 opacity-60">{plan.startTime}</span>{plan.title}
                  </button>
                ))}
                {dayPlans.length > 3 && <p data-export-ignore="true" className="px-1 text-[10px] text-[#777]">还有 {dayPlans.length - 3} 项</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ days, today, plans, categoryMeta, timeline, onCreate, onEdit, onDrop, onDragStart, onDragEnd, dropTarget, setDropTarget }: { days: Date[]; today: Date; plans: Plan[]; categoryMeta: CategoryDisplayMap; timeline: TimelineSettings; onCreate: (date: Date, time?: string) => void; onEdit: (plan: Plan) => void } & CalendarDragProps) {
  const timelineHours = Array.from({ length: timeline.endHour - timeline.startHour + 1 }, (_, index) => timeline.startHour + index);
  const timelineHeight = (timeline.endHour - timeline.startHour) * timeline.hourHeight;
  const timelineStyle = { height: timelineHeight, '--hour-height': `${timeline.hourHeight}px` } as CSSProperties;
  return (
    <div className="calendar-export-card overflow-auto rounded-xl border border-[#dedede] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04)]">
      <div className="grid min-w-[920px] grid-cols-[56px_repeat(7,minmax(122px,1fr))] border-b border-[#dedede] bg-[#fafafa]">
        <div />
        {days.map((day, index) => (
          <div key={toISO(day)} className="border-l border-[#e6e6e6] px-3 py-3 text-center">
            <p className="text-[11px] text-[#777]">{weekdayNames[index]}</p>
            <span className={`mt-1 inline-grid size-7 place-items-center rounded-full text-sm font-semibold ${isSameDay(day, today) ? 'bg-black text-white' : ''}`}>{day.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="timeline-grid relative grid min-w-[920px] grid-cols-[56px_repeat(7,minmax(122px,1fr))]" style={timelineStyle}>
        <div className="relative">
          {timelineHours.map((hour, index) => <span key={hour} className="absolute right-3 -translate-y-1/2 text-[10px] text-[#999]" style={{ top: Math.min(index * timeline.hourHeight, timelineHeight - 1) }}>{pad(hour)}:00</span>)}
        </div>
        {days.map((day) => {
          const dayPlans = layoutTimelinePlans(plans.filter((plan) => plan.date === toISO(day)));
          const targetId = `week-${toISO(day)}`;
          return (
            <div
              key={toISO(day)}
              className={`relative border-l border-[#e6e6e6] ${isSameDay(day, today) ? 'bg-violet-50/30' : ''} ${dropTarget === targetId ? 'calendar-drop-active' : ''}`}
              onDoubleClick={(event) => {
                onCreate(day, timeFromPointer(event, event.currentTarget, timeline));
              }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(targetId); }}
              onDrop={(event) => onDrop(event, day, timeFromPointer(event, event.currentTarget, timeline))}
            >
              {dayPlans.map((placement) => <TimelinePlan key={placement.plan.id} placement={placement} categoryMeta={categoryMeta} timeline={timeline} onEdit={onEdit} onDragStart={onDragStart} onDragEnd={onDragEnd} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ day, today, plans, categoryMeta, timeline, onCreate, onEdit, onDrop, onDragStart, onDragEnd, dropTarget, setDropTarget }: { day: Date; today: Date; plans: Plan[]; categoryMeta: CategoryDisplayMap; timeline: TimelineSettings; onCreate: (date: Date, time?: string) => void; onEdit: (plan: Plan) => void } & CalendarDragProps) {
  const dayPlans = plans.filter((plan) => plan.date === toISO(day));
  const dayPlacements = layoutTimelinePlans(dayPlans);
  const timelineHours = Array.from({ length: timeline.endHour - timeline.startHour + 1 }, (_, index) => timeline.startHour + index);
  const timelineHeight = (timeline.endHour - timeline.startHour) * timeline.hourHeight;
  const timelineStyle = { height: timelineHeight, '--hour-height': `${timeline.hourHeight}px` } as CSSProperties;
  return (
    <div className="day-view-grid grid gap-4 2xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="calendar-export-card overflow-hidden rounded-xl border border-[#dedede] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04)]">
        <div className="flex items-center justify-between border-b border-[#dedede] bg-[#fafafa] px-5 py-4">
          <div className="flex items-center gap-3"><span className={`grid size-9 place-items-center rounded-full text-sm font-semibold ${isSameDay(day, today) ? 'bg-black text-white' : 'bg-[#ededed]'}`}>{day.getDate()}</span><div><p className="text-sm font-semibold">{weekdayNames[(day.getDay() + 6) % 7]}</p><p className="text-[11px] text-[#777]">{formatChineseDate(day)}</p></div></div>
          <button data-export-ignore="true" onClick={() => onCreate(day)} className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-medium text-white"><CirclePlus className="size-3.5" />添加</button>
        </div>
        <div className="timeline-grid relative grid grid-cols-[64px_1fr]" style={timelineStyle}>
          <div className="relative">{timelineHours.map((hour, index) => <span key={hour} className="absolute right-3 -translate-y-1/2 text-[10px] text-[#999]" style={{ top: Math.min(index * timeline.hourHeight, timelineHeight - 1) }}>{pad(hour)}:00</span>)}</div>
          <div
            className={`relative border-l border-[#e6e6e6] ${dropTarget === `day-${toISO(day)}` ? 'calendar-drop-active' : ''}`}
            onDoubleClick={(event) => {
              onCreate(day, timeFromPointer(event, event.currentTarget, timeline));
            }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(`day-${toISO(day)}`); }}
            onDrop={(event) => onDrop(event, day, timeFromPointer(event, event.currentTarget, timeline))}
          >
            {dayPlacements.map((placement) => <TimelinePlan key={placement.plan.id} placement={placement} categoryMeta={categoryMeta} timeline={timeline} onEdit={onEdit} onDragStart={onDragStart} onDragEnd={onDragEnd} wide />)}
          </div>
        </div>
      </div>
      <aside data-export-ignore="true" className="h-fit rounded-xl border border-[#dedede] bg-[#fafafa] p-4">
        <p className="text-xs font-semibold">今日摘要</p>
        <div className="mt-3 flex items-end gap-2"><span className="text-3xl font-semibold">{dayPlans.length}</span><span className="pb-1 text-xs text-[#777]">项计划</span></div>
        <div className="mt-4 space-y-3">
          {dayPlans.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((plan) => (
            <button key={plan.id} onClick={() => onEdit(plan)} className="flex w-full items-start gap-2 text-left">
              <span className={`mt-1 size-2 rounded-full ${categoryDisplay(categoryMeta, plan.category).dot}`} />
              <span><span className={`block text-xs font-medium ${plan.completed ? 'plan-completed-title' : ''}`}>{plan.title}</span><span className="text-[10px] text-[#777]">{plan.startTime}–{plan.endTime}</span></span>
            </button>
          ))}
          {!dayPlans.length && <p className="text-xs leading-5 text-[#888]">今天还没有安排。双击时间轴即可快速添加。</p>}
        </div>
      </aside>
    </div>
  );
}

function timeFromPointer(event: { clientY: number }, element: HTMLElement, timeline: TimelineSettings) {
  const offset = Math.max(0, event.clientY - element.getBoundingClientRect().top);
  const rawMinutes = timeline.startHour * 60 + Math.round((offset / timeline.hourHeight) * 4) * 15;
  const total = Math.max(timeline.startHour * 60, Math.min(timeline.endHour * 60 - 15, rawMinutes));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

type TimelinePlanPlacement = {
  plan: Plan;
  column: number;
  columnCount: number;
};

function layoutTimelinePlans(plans: Plan[]): TimelinePlanPlacement[] {
  const sorted = [...plans]
    .map((plan) => ({ plan, start: minutes(plan.startTime), end: Math.max(minutes(plan.startTime) + 30, minutes(plan.endTime)) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.plan.id.localeCompare(b.plan.id));
  const placements: TimelinePlanPlacement[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((item) => {
      let column = laneEnds.findIndex((end) => end <= item.start);
      if (column === -1) {
        column = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[column] = item.end;
      }
      return { plan: item.plan, column };
    });
    const columnCount = laneEnds.length;
    placements.push(...assigned.map((item) => ({ ...item, columnCount })));
    cluster = [];
    clusterEnd = -1;
  };

  sorted.forEach((item) => {
    if (cluster.length && item.start >= clusterEnd) flushCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  });
  flushCluster();
  return placements;
}

function TimelinePlan({ placement, categoryMeta, timeline, onEdit, onDragStart, onDragEnd, wide = false }: { placement: TimelinePlanPlacement; categoryMeta: CategoryDisplayMap; timeline: TimelineSettings; onEdit: (plan: Plan) => void; onDragStart: (event: ReactDragEvent, payload: DragPayload) => void; onDragEnd: () => void; wide?: boolean }) {
  const { plan, column, columnCount } = placement;
  const start = minutes(plan.startTime);
  const end = Math.max(start + 30, minutes(plan.endTime));
  const rangeStart = timeline.startHour * 60;
  const rangeEnd = timeline.endHour * 60;
  if (end <= rangeStart || start >= rangeEnd) return null;
  const top = ((Math.max(start, rangeStart) - rangeStart) / 60) * timeline.hourHeight;
  const bottom = ((Math.min(end, rangeEnd) - rangeStart) / 60) * timeline.hourHeight;
  const height = Math.max(24, bottom - top - 3);
  const columnWidth = 100 / columnCount;
  const horizontalStyle = columnCount === 1
    ? { left: '6px', width: 'calc(100% - 12px)' }
    : { left: `calc(${column * columnWidth}% + ${column === 0 ? 6 : 2}px)`, width: `calc(${columnWidth}% - ${column === 0 ? 8 : 4}px)` };
  return (
    <button
      draggable
      data-plan-id={plan.id}
      data-overlap-column={column + 1}
      data-overlap-columns={columnCount}
      title={`${plan.title} · ${plan.startTime}–${plan.endTime}`}
      onDragStart={(event) => onDragStart(event, { kind: 'plan', id: plan.id })}
      onDragEnd={onDragEnd}
      onClick={() => onEdit(plan)}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`absolute z-10 min-w-0 cursor-grab overflow-hidden rounded-md border p-2 text-left shadow-sm transition hover:z-30 hover:-translate-y-px hover:shadow-md focus:z-30 active:cursor-grabbing ${categoryDisplay(categoryMeta, plan.category).card} ${plan.completed ? 'plan-completed' : ''}`}
      style={{ top: Math.max(0, top), height, ...horizontalStyle, maxWidth: wide && columnCount === 1 ? '42rem' : undefined }}
    >
      <p className="truncate text-[11px] font-semibold">{plan.title}</p>
      {height > 42 && <p className="mt-1 flex items-center gap-1 text-[9px] opacity-70"><Clock3 className="size-2.5" />{plan.startTime}–{plan.endTime}</p>}
    </button>
  );
}

function PlanList({ plans, categoryMeta, emptyText, onEdit, onToggle }: { plans: Plan[]; categoryMeta: CategoryDisplayMap; emptyText: string; onEdit: (plan: Plan) => void; onToggle: (id: string) => void }) {
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
              <p className="mt-1 text-[11px] text-[#777]">{plan.date} · {plan.startTime}–{plan.endTime} · {categoryDisplay(categoryMeta, plan.category).label}</p>
            </button>
            {plan.source !== 'manual' && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] text-violet-700">{plan.source === 'ai' ? 'DeepSeek' : '快捷'}</span>}
          </div>
        ))}
        {!sorted.length && <div className="grid min-h-64 place-items-center p-8 text-center"><div><Inbox className="mx-auto size-8 text-[#bbb]" /><p className="mt-3 text-sm font-medium">这里还是空的</p><p className="mt-1 text-xs text-[#888]">{emptyText}</p></div></div>}
      </div>
    </div>
  );
}

function CountdownWidget({ timer, remaining, plans, expanded, offsetForPool, onClose, onToggleExpanded, onBindPlan, onDurationChange, onStart, onPause, onReset, onCompletePlan }: {
  timer: CountdownTimer;
  remaining: number;
  plans: Plan[];
  expanded: boolean;
  offsetForPool: boolean;
  onClose: () => void;
  onToggleExpanded: () => void;
  onBindPlan: (planId: string) => void;
  onDurationChange: (seconds: number) => void;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onCompletePlan: () => void;
}) {
  const circumference = 2 * Math.PI * 92;
  const progress = timer.durationSeconds > 0 ? Math.max(0, Math.min(1, remaining / timer.durationSeconds)) : 0;
  const finishAt = timer.endsAt ? new Date(timer.endsAt) : new Date(Date.now() + remaining * 1000);
  const canEdit = timer.status !== 'running';
  const boundPlanExists = Boolean(timer.planId && plans.some((plan) => plan.id === timer.planId));
  const sortedPlans = [...plans].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  const durationHours = Math.floor(timer.durationSeconds / 3600);
  const durationMinutes = Math.floor((timer.durationSeconds % 3600) / 60);
  const durationSeconds = timer.durationSeconds % 60;
  const updateDurationPart = (part: 'hours' | 'minutes' | 'seconds', rawValue: number) => {
    const value = Number.isFinite(rawValue) ? Math.max(0, Math.floor(rawValue)) : 0;
    const nextHours = part === 'hours' ? Math.min(99, value) : durationHours;
    const nextMinutes = part === 'minutes' ? Math.min(59, value) : durationMinutes;
    const nextSeconds = part === 'seconds' ? Math.min(59, value) : durationSeconds;
    onDurationChange(Math.max(1, nextHours * 3600 + nextMinutes * 60 + nextSeconds));
  };

  return (
    <section
      data-export-ignore="true"
      role="dialog"
      aria-label="计划倒计时器"
      className={`countdown-widget ${expanded ? 'is-expanded' : ''} ${timer.status === 'finished' ? 'is-finished' : ''}`}
      style={{ '--timer-right': offsetForPool ? '380px' : '20px' } as CSSProperties}
    >
      <header className="countdown-widget-header">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{countdownDurationLabel(timer.durationSeconds)}</p>
          <p className="mt-0.5 truncate text-[10px] text-white/55">{timer.label}</p>
        </div>
        <div className="flex gap-1">
          <button onClick={onToggleExpanded} aria-label={expanded ? '缩小计时器' : '放大计时器'} className="countdown-header-button">{expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
          <button onClick={onClose} aria-label="收起计时器" className="countdown-header-button"><X className="size-4" /></button>
        </div>
      </header>

      <label className="countdown-plan-select-label">
        <span>绑定计划</span>
        <select value={timer.planId || ''} disabled={!canEdit} onChange={(event) => onBindPlan(event.target.value)} className="countdown-plan-select">
          <option value="">独立专注计时</option>
          {sortedPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.date} {plan.startTime} · {plan.title}</option>)}
        </select>
      </label>

      <div className="countdown-dial" aria-live="polite">
        <svg viewBox="0 0 224 224" aria-hidden="true">
          <circle className="countdown-track" cx="112" cy="112" r="92" />
          <circle
            className="countdown-progress"
            cx="112"
            cy="112"
            r="92"
            style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }}
          />
        </svg>
        <div className="countdown-dial-content">
          <strong>{formatCountdown(remaining)}</strong>
          <span className="countdown-finish-time"><BellRing className="size-3" />{timer.status === 'finished' ? '时间到' : `结束于 ${pad(finishAt.getHours())}:${pad(finishAt.getMinutes())}`}</span>
        </div>
      </div>

      <div className="countdown-controls">
        <button onClick={timer.status === 'running' ? onPause : onStart} aria-label={timer.status === 'running' ? '暂停倒计时' : timer.status === 'paused' ? '继续倒计时' : '开始倒计时'} className="countdown-primary-control">
          {timer.status === 'running' ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
        </button>
        <button onClick={onReset} aria-label="重置倒计时" title="重置" className="countdown-secondary-control"><RotateCcw className="size-4" /></button>
      </div>

      {timer.status === 'finished' && boundPlanExists && <button onClick={onCompletePlan} className="countdown-complete-plan"><CheckCircle2 className="size-3.5" />标记计划完成</button>}

      <div className="countdown-settings">
        <div className="countdown-presets">
          {TIMER_PRESETS.map((minutesValue) => (
            <button key={minutesValue} disabled={!canEdit} onClick={() => onDurationChange(minutesValue * 60)} className={timer.durationSeconds === minutesValue * 60 ? 'is-selected' : ''}>{minutesValue} 分</button>
          ))}
        </div>
        <div className="countdown-custom-duration">
          <span>自定义</span>
          <label><input aria-label="自定义小时" type="number" min={0} max={99} disabled={!canEdit} value={durationHours} onChange={(event) => updateDurationPart('hours', Number(event.target.value))} /><span>时</span></label>
          <label><input aria-label="自定义分钟" type="number" min={0} max={59} disabled={!canEdit} value={durationMinutes} onChange={(event) => updateDurationPart('minutes', Number(event.target.value))} /><span>分</span></label>
          <label><input aria-label="自定义秒" type="number" min={0} max={59} disabled={!canEdit} value={durationSeconds} onChange={(event) => updateDurationPart('seconds', Number(event.target.value))} /><span>秒</span></label>
        </div>
      </div>
    </section>
  );
}

function PlanModal({ draft, setDraft, categories, editing, completed, plan, onSubmit, onClose, onDelete, onToggleCompleted, onStartTimer }: { draft: PlanDraft; setDraft: (draft: PlanDraft) => void; categories: CategoryDefinition[]; editing: boolean; completed: boolean; plan?: Plan; onSubmit: (event: FormEvent) => void; onClose: () => void; onDelete: () => void; onToggleCompleted: () => void; onStartTimer: (plan: Plan) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={onSubmit} className="modal-card max-w-[520px]">
        <div className="flex items-center justify-between border-b border-[#e7e7e7] px-5 py-4"><div><h2 className="text-base font-semibold">{editing ? '编辑计划' : '新建计划'}</h2><p className="mt-0.5 text-[11px] text-[#777]">给重要的事留出明确时间</p></div><button type="button" onClick={onClose} className="icon-button border-0"><X className="size-4" /></button></div>
        <div className="space-y-4 p-5">
          <label className="field-label">计划标题<input autoFocus required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="field-input" placeholder="例如：完成产品方案初稿" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="field-label col-span-2 sm:col-span-1">日期<input required type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="field-input" /></label>
            <label className="field-label col-span-2 sm:col-span-1">分类<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} className="field-input">{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
            <label className="field-label">开始<input required type="time" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} className="field-input" /></label>
            <label className="field-label">结束<input required type="time" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} className="field-input" /></label>
          </div>
          <label className="field-label">备注<textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className="field-input min-h-24 resize-none" placeholder="补充目标、资料或完成标准（可选）" /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#e7e7e7] px-5 py-4">
          {editing && <button type="button" onClick={onDelete} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"><Trash2 className="size-3.5" />删除</button>}
          {editing && <button type="button" onClick={onToggleCompleted} className="rounded-lg border border-[#d8d8d8] px-3 py-2 text-xs font-medium hover:bg-[#f6f6f6]">{completed ? '恢复未完成' : '标记完成'}</button>}
          {editing && plan && !completed && <button type="button" onClick={() => onStartTimer(plan)} className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-100"><TimerIcon className="size-3.5" />开始倒计时</button>}
          <div className="ml-auto flex gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[#d8d8d8] px-4 py-2 text-xs font-medium hover:bg-[#f6f6f6]">取消</button><button className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-[#292929]">{editing ? '保存更改' : '添加计划'}</button></div>
        </div>
      </form>
    </div>
  );
}

function PoolModal({ draft, setDraft, categories, editing, onSubmit, onClose, onDelete }: { draft: PoolDraft; setDraft: (draft: PoolDraft) => void; categories: CategoryDefinition[]; editing: boolean; onSubmit: (event: FormEvent) => void; onClose: () => void; onDelete: () => void }) {
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
            <label className="field-label">分类<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} className="field-input">{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          </div>
          <label className="field-label">完成标准 / 备注<textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className="field-input min-h-24 resize-none" placeholder="AI 会参考这里的信息自动排期（可选）" /></label>
        </div>
        <div className="flex items-center border-t border-[#e7e7e7] px-5 py-4">{editing && <button type="button" onClick={onDelete} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"><Trash2 className="size-3.5" />删除</button>}<div className="ml-auto flex gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[#d8d8d8] px-4 py-2 text-xs font-medium">取消</button><button className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white">{editing ? '保存更改' : '放入计划池'}</button></div></div>
      </form>
    </div>
  );
}

function CategoryManagerModal({ categories, onClose, onSave }: { categories: CategoryDefinition[]; onClose: () => void; onSave: (categories: CategoryDefinition[]) => void }) {
  const [draft, setDraft] = useState<CategoryDefinition[]>(categories);
  const labels = draft.map((category) => category.label.trim());
  const invalid = labels.some((label) => !label) || new Set(labels).size !== labels.length;

  const updateCategory = (id: string, patch: Partial<CategoryDefinition>) => {
    setDraft((current) => current.map((category) => category.id === id ? { ...category, ...patch } : category));
  };

  const addCategory = () => {
    if (draft.length >= 12) return;
    const color = categoryColors[draft.length % categoryColors.length];
    setDraft((current) => [...current, { id: `custom-${newId()}`, label: `新分类 ${current.length + 1}`, color }]);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card max-w-[560px]">
        <div className="flex items-center justify-between border-b border-[#e7e7e7] px-5 py-4">
          <div><h2 className="text-base font-semibold">分类管理</h2><p className="mt-0.5 text-[11px] text-[#777]">编辑名称与颜色，最多保留 12 个分类</p></div>
          <button onClick={onClose} className="icon-button border-0"><X className="size-4" /></button>
        </div>
        <div className="max-h-[58vh] space-y-2 overflow-y-auto p-5">
          {draft.map((category) => (
            <div key={category.id} className="flex items-center gap-3 rounded-lg border border-[#e1e1e1] bg-[#fafafa] p-3">
              <span className={`size-2.5 shrink-0 rounded-full ${categoryColorMeta[category.color].dot}`} />
              <input value={category.label} maxLength={12} onChange={(event) => updateCategory(category.id, { label: event.target.value })} aria-label="分类名称" className="field-input min-w-0 flex-1 bg-white" />
              <div className="flex shrink-0 items-center gap-1">
                {categoryColors.map((color) => (
                  <button key={color} onClick={() => updateCategory(category.id, { color })} aria-label={`选择${color}颜色`} className={`grid size-6 place-items-center rounded-full transition ${category.color === color ? 'bg-white ring-1 ring-[#aaa]' : 'hover:bg-white'}`}>
                    <span className={`size-2.5 rounded-full ${categoryColorMeta[color].dot}`} />
                  </button>
                ))}
              </div>
              {category.id === 'personal' ? <span className="w-8 shrink-0 text-center text-[9px] text-[#999]">基础</span> : <button onClick={() => setDraft((current) => current.filter((item) => item.id !== category.id))} aria-label={`删除${category.label}分类`} className="grid size-8 shrink-0 place-items-center rounded-md text-[#999] transition hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></button>}
            </div>
          ))}
          <button onClick={addCategory} disabled={draft.length >= 12} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#c8c8c8] py-3 text-xs font-medium text-[#666] transition hover:border-[#999] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-40"><CirclePlus className="size-3.5" />新增分类</button>
          {invalid && <p className="text-[10px] text-red-600">分类名称不能为空或重复。</p>}
          <p className="text-[10px] leading-5 text-[#888]">“个人”是基础分类，不能删除。删除其他分类后，相关计划会自动转移到“个人”。</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e7e7e7] px-5 py-4"><button onClick={onClose} className="rounded-lg border border-[#d8d8d8] px-4 py-2 text-xs font-medium">取消</button><button disabled={invalid} onClick={() => onSave(draft)} className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">保存分类</button></div>
      </section>
    </div>
  );
}

function IcsEmailModal({ plans, smtpPassword, setSmtpPassword, error, sending, onSubmit, onClose }: { plans: Plan[]; smtpPassword: string; setSmtpPassword: (value: string) => void; error: string; sending: boolean; onSubmit: (event: FormEvent) => void; onClose: () => void }) {
  const sorted = [...plans].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={onSubmit} className="modal-card max-w-[620px]">
        <div className="flex items-start justify-between border-b border-[#e7e7e7] px-5 py-4">
          <div className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700"><Mail className="size-4" /></div><div><h2 className="text-base font-semibold">发送到 iPhone 日历</h2><p className="mt-1 text-xs leading-5 text-[#777]">生成兼容的 ICS 附件，并发送到 bluecat16384@163.com</p></div></div>
          <button type="button" onClick={onClose} disabled={sending} className="icon-button border-0 disabled:opacity-40"><X className="size-4" /></button>
        </div>
        <div className="max-h-[62vh] space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-4 gap-2 text-center text-[10px] leading-4 text-[#666]">
            {['生成 ICS', '邮件附件', 'iPhone 打开', '加入日历'].map((step, index) => (
              <div key={step} className="relative rounded-lg border border-[#e2e2e2] bg-[#fafafa] px-2 py-2.5"><span className="mx-auto mb-1 grid size-5 place-items-center rounded-full bg-black text-[9px] text-white">{index + 1}</span>{step}{index < 3 && <span className="absolute -right-2 top-1/2 z-10 -translate-y-1/2 bg-white px-0.5 text-[#aaa]">→</span>}</div>
            ))}
          </div>
          <div className="rounded-xl border border-[#dedede] bg-[#fafafa] p-3">
            <div className="flex items-center justify-between"><p className="text-xs font-semibold">附件事件摘要</p><span className="rounded-full bg-white px-2 py-1 text-[9px] text-[#666]">共 {sorted.length} 项</span></div>
            <div className="mt-2 space-y-1.5">
              {sorted.slice(0, 5).map((plan) => <div key={plan.id} className="flex items-center gap-2 text-[10px]"><span className="w-[92px] shrink-0 tabular-nums text-[#777]">{plan.date} {plan.startTime}</span><span className="truncate font-medium">{plan.title}</span></div>)}
              {sorted.length > 5 && <p className="pt-1 text-[10px] text-[#888]">以及另外 {sorted.length - 5} 项计划</p>}
            </div>
          </div>
          <label className="field-label">163 邮箱客户端授权码
            <input
              required
              autoFocus
              type="password"
              autoComplete="off"
              value={smtpPassword}
              onChange={(event) => setSmtpPassword(event.target.value)}
              className="field-input"
              placeholder="不是邮箱登录密码"
              aria-describedby="smtp-password-help"
            />
          </label>
          <div id="smtp-password-help" className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-[10px] leading-5 text-emerald-800"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" /><p>授权码只在本次发送时交给本机 Go 服务使用，不会保存到浏览器、SQLite、.env、日志或 Git。</p></div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#e7e7e7] px-5 py-4">
          <p className="text-[10px] leading-4 text-[#888]">点击确认后会立即发送真实邮件</p>
          <div className="flex gap-2"><button type="button" onClick={onClose} disabled={sending} className="rounded-lg border border-[#d8d8d8] px-4 py-2 text-xs font-medium disabled:opacity-40">取消</button><button disabled={!smtpPassword.trim() || sending} className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{sending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{sending ? '发送中' : '确认发送邮件'}</button></div>
        </div>
      </form>
    </div>
  );
}

function AiPreviewModal({ preview, categoryMeta, onClose, onAdd }: { preview: AiPreview; categoryMeta: CategoryDisplayMap; onClose: () => void; onAdd: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card max-w-[620px]">
        <div className="flex items-start justify-between border-b border-[#e7e7e7] px-5 py-4"><div className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700"><Sparkles className="size-4" /></div><div><h2 className="text-base font-semibold">智能安排预览</h2><p className="mt-1 max-w-md text-xs leading-5 text-[#777]">{preview.summary}</p></div></div><button onClick={onClose} className="icon-button border-0"><X className="size-4" /></button></div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-5">
          {preview.plans.map((plan, index) => (
            <div key={`${plan.date}-${plan.title}-${index}`} className="flex items-start gap-3 rounded-lg border border-[#e1e1e1] p-3">
              <span className={`mt-1 size-2 rounded-full ${categoryDisplay(categoryMeta, plan.category).dot}`} />
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
