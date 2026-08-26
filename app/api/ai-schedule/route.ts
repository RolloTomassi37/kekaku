type TaskInput = {
  id: string;
  title: string;
  duration: number;
  priority: 'high' | 'medium' | 'low';
  category: string;
  note: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function cleanTask(value: unknown): TaskInput | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.title !== 'string' || !item.title.trim()) return null;
  const duration = Number(item.duration);
  return {
    id: item.id.slice(0, 100),
    title: item.title.trim().slice(0, 80),
    duration: Number.isFinite(duration) ? Math.min(480, Math.max(15, duration)) : 60,
    priority: item.priority === 'high' || item.priority === 'low' ? item.priority : 'medium',
    category: typeof item.category === 'string' && item.category.trim() ? item.category.trim().slice(0, 80) : 'personal',
    note: typeof item.note === 'string' ? item.note.trim().slice(0, 240) : '',
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const rangeStart = typeof body.rangeStart === 'string' && datePattern.test(body.rangeStart) ? body.rangeStart : '';
    const rangeEnd = typeof body.rangeEnd === 'string' && datePattern.test(body.rangeEnd) ? body.rangeEnd : '';
    const timezone = typeof body.timezone === 'string' ? body.timezone.slice(0, 80) : 'Asia/Shanghai';
    const tasks = Array.isArray(body.tasks) ? body.tasks.map(cleanTask).filter((task): task is TaskInput => Boolean(task)).slice(0, 30) : [];
    const existingPlans = Array.isArray(body.existingPlans)
      ? body.existingPlans.slice(0, 100).map((value) => {
          const item = value as Record<string, unknown>;
          return {
            title: typeof item.title === 'string' ? item.title.slice(0, 80) : '已有计划',
            date: typeof item.date === 'string' ? item.date : '',
            startTime: typeof item.startTime === 'string' ? item.startTime : '',
            endTime: typeof item.endTime === 'string' ? item.endTime : '',
          };
        }).filter((item) => datePattern.test(item.date) && timePattern.test(item.startTime) && timePattern.test(item.endTime))
      : [];

    if (!rangeStart || !rangeEnd || rangeEnd < rangeStart || !tasks.length) {
      return Response.json({ error: '计划池数据或排期范围无效。' }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return Response.json({ error: 'DeepSeek 服务尚未配置。' }, { status: 503 });

    const allowedIds = new Set(tasks.map((task) => task.id));
    const deepSeekResponse = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        response_format: { type: 'json_object' },
        max_tokens: 2600,
        messages: [
          {
            role: 'system',
            content: `你是专业的中文时间规划助手。用户时区是 ${timezone}，排期范围是 ${rangeStart} 至 ${rangeEnd}。把计划池事项安排进真实日历，并严格避开已有计划。优先安排高优先级；结合事项分类和语义选择合理时段；同一天避免排得过满；每项必须完整占用其 duration 分钟。只返回 JSON 对象，结构为：{"summary":"排期说明","plans":[{"poolId":"原事项 id","title":"事项标题","date":"YYYY-MM-DD","startTime":"HH:mm","endTime":"HH:mm","category":"原事项 category","note":"安排理由或完成标准"}]}。每个 poolId 只能出现一次，不能新增不存在的事项，必须保留原事项 category，JSON 以外不要输出内容。`,
          },
          {
            role: 'user',
            content: `请对以下计划池事项自动排期并返回 JSON。计划池：${JSON.stringify(tasks)}。已有日程：${JSON.stringify(existingPlans)}。`,
          },
        ],
      }),
    });

    if (!deepSeekResponse.ok) return Response.json({ error: 'DeepSeek 暂时不可用。' }, { status: 502 });
    const payload = (await deepSeekResponse.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return Response.json({ error: 'DeepSeek 没有返回排期。' }, { status: 502 });

    const parsed = JSON.parse(content) as { summary?: unknown; plans?: unknown };
    const seen = new Set<string>();
    const plans = Array.isArray(parsed.plans) ? parsed.plans.map((value) => {
      if (!value || typeof value !== 'object') return null;
      const item = value as Record<string, unknown>;
      const poolId = typeof item.poolId === 'string' ? item.poolId : '';
      if (!allowedIds.has(poolId) || seen.has(poolId)) return null;
      if (typeof item.date !== 'string' || item.date < rangeStart || item.date > rangeEnd || !datePattern.test(item.date)) return null;
      if (typeof item.startTime !== 'string' || typeof item.endTime !== 'string' || !timePattern.test(item.startTime) || !timePattern.test(item.endTime)) return null;
      const source = tasks.find((task) => task.id === poolId);
      if (!source) return null;
      seen.add(poolId);
      return {
        poolId,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 80) : source.title,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        category: source.category,
        note: typeof item.note === 'string' ? item.note.trim().slice(0, 240) : source.note,
      };
    }).filter(Boolean) : [];

    if (!plans.length) return Response.json({ error: '没有生成可用排期。' }, { status: 422 });
    return Response.json({
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 240) : `已安排 ${plans.length} 项计划。`,
      plans,
    });
  } catch {
    return Response.json({ error: '自动排期失败，请稍后再试。' }, { status: 500 });
  }
}
