/**
 * Графіки на Recharts.
 *
 * Спершу я намалював їх SVG вручну «щоб без залежностей», але це поганий обмін:
 * підказки при наведенні, легенди, адаптивність під ширину контейнера й
 * доступність довелося б писати й підтримувати самому. Recharts дає це з коробки.
 */
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Lead } from './api';
import { statusStyle } from './status';

const PALETTE = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];

const AXIS = { fontSize: 12, fill: 'currentColor', opacity: 0.75 };

export function countBy(rows: Lead[], key: (r: Lead) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = (key(r) || '—').toString().trim() || '—';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function ChartFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, opacity: 0.7 }}>{title}</div>
      {children}
    </div>
  );
}

/** Горизонтальні стовпчики: читаються краще, коли підписи довгі (міста, ніші). */
export function BarList({
  data,
  title,
  max = 8,
  color = PALETTE[0],
}: {
  data: [string, number][];
  title: string;
  max?: number;
  color?: string;
}) {
  const rows = data.slice(0, max).map(([name, value]) => ({
    name: name.length > 24 ? `${name.slice(0, 23)}…` : name,
    value,
  }));

  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 28)}>
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={140} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: 'currentColor', opacity: 0.06 }}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11 }} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Розподіл оцінки сайту 1-10.
 * Кольори навмисно «перевернуті»: зелене — погані сайти, бо це найкращі ліди.
 */
export function ScoreHistogram({ rows, title }: { rows: Lead[]; title: string }) {
  const data = Array.from({ length: 10 }, (_, i) => {
    const score = i + 1;
    return {
      score: String(score),
      n: rows.filter((r) => Number(r['Оцінка сайту 1-10']) === score).length,
    };
  });

  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ left: 0, right: 4, top: 12, bottom: 0 }}>
          <XAxis dataKey="score" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: 'currentColor', opacity: 0.06 }}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
            formatter={(v) => [String(v ?? 0), 'лідів']}
            labelFormatter={(l) => `оцінка ${l}/10`}
          />
          <Bar dataKey="n" radius={[3, 3, 0, 0]} label={{ position: 'top', fontSize: 10 }}>
            {data.map((d) => {
              const s = Number(d.score);
              return (
                <Cell key={d.score} fill={s <= 3 ? '#059669' : s <= 6 ? '#d97706' : '#94a3b8'} />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, opacity: 0.6 }}>
        1 = сайт жахливий = найкращий лід · 10 = сайт нормальний
      </div>
    </ChartFrame>
  );
}

/** Воронка статусів у вигляді кільця: одразу видно частку неопрацьованих. */
export function StatusDonut({
  rows,
  statuses,
  title,
}: {
  rows: Lead[];
  statuses: string[];
  title: string;
}) {
  // Кольори беремо з того ж джерела, що й картки: інакше «зелене» на діаграмі
  // й «зелене» біля ліда означали б різне
  const data = ['', ...statuses]
    .map((s) => ({
      name: s || 'Не опрацьовано',
      value: rows.filter((r) => (r['Статус'] ?? '').toString().trim() === s).length,
      fill: statusStyle(s).color,
    }))
    .filter((d) => d.value > 0);

  if (!data.length) return <ChartFrame title={title}><div style={{ fontSize: 12, opacity: 0.6 }}>Немає даних</div></ChartFrame>;

  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
