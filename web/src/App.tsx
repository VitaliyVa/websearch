import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Text } from '@astryxdesign/core/Text';
import {
  ApiError,
  clearCode,
  fetchLeads,
  loadCode,
  saveCode,
  updateLead,
  type Lead,
  type Payload,
} from './api';
import { BarList, ScoreHistogram, StatusDonut, countBy } from './charts';
import {
  AlertTriangle, ChevronDown, Clock, ExternalLink, Gauge, Globe, Image as ImageIcon,
  Layers, Lock, Logout, Mail, MapPin, Phone, Refresh, ShieldOff, Smartphone,
  Stars, Tag, Target, Users,
} from './icons';

type TabKey = 'leads' | 'manual' | 'noSite';

const TAB_LABEL: Record<TabKey, string> = {
  leads: 'Ліди',
  manual: 'Ручна перевірка',
  noSite: 'Без сайту',
};

/* Скріншоти лежать у самій збірці — Apps Script їх не віддає і не мусить. */
const shotUrl = (placeId: string, kind: 'mobile' | 'desktop') =>
  `${import.meta.env.BASE_URL}shots/${placeId}-${kind}.jpg`;

const row = (gap = 12): React.CSSProperties => ({
  display: 'flex',
  gap,
  alignItems: 'center',
  flexWrap: 'wrap',
});

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** «4.1 / 268» → {rating: 4.1, reviews: 268} */
function parseRating(v: unknown): { rating: number | null; reviews: number } {
  const m = /^\s*([\d.]+|—)\s*\/\s*(\d+)/.exec(String(v ?? ''));
  if (!m) return { rating: null, reviews: 0 };
  return { rating: m[1] === '—' ? null : Number(m[1]), reviews: Number(m[2]) };
}

/** «23 / 61» → [23, 61]; «не заміряно» → [null, null] */
function parsePsi(v: unknown): [number | null, number | null] {
  const m = /(\d+|\?)\s*\/\s*(\d+|\?)/.exec(String(v ?? ''));
  if (!m) return [null, null];
  const p = (s: string) => (s === '?' ? null : Number(s));
  return [p(m[1]!), p(m[2]!)];
}

const countStars = (v: unknown) => (String(v ?? '').match(/★/g) ?? []).length;

/**
 * Дата контакту приходить або рядком, або серійним числом Google Sheets.
 *
 * Число з'являється, коли значення записав не Apps Script (він віддає Date і
 * форматує сам), а, наприклад, наш експорт при перенесенні нотаток. Показувати
 * продажнику «46238.543027673615» — гірше, ніж не показувати нічого.
 */
function formatSheetDate(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Number(s);
  // 25569 — днів між епохою Sheets (1899-12-30) і Unix
  if (Number.isFinite(n) && n > 20_000 && n < 100_000) {
    return new Date((n - 25569) * 86_400_000).toLocaleDateString('uk-UA');
  }
  return s;
}

/** Прибирає зірки з рядка складності, лишаючи словесний опис. */
const difficultyLabel = (v: unknown) => String(v ?? '').replace(/[★☆]/g, '').trim();

export default function App() {
  const [code, setCode] = useState(loadCode());
  const [user, setUser] = useState<string | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>('leads');
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('Оцінка сайту 1-10');
  const [saving, setSaving] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ id: string; name: string } | null>(null);
  /*
   * Час останнього завантаження. На спільній панелі це не косметика:
   * Apps Script кешує відповідь на 60 секунд, тож продажник може дивитись на
   * дані, змінені колегою хвилину тому, і не розуміти цього.
   */
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const login = useCallback(async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const { user: u, data } = await fetchLeads(c);
      setUser(u);
      setPayload(data);
      setLoadedAt(new Date());
      saveCode(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setUser(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Автовхід, якщо код лишився в сесії
  useEffect(() => {
    if (code) void login(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc закриває лайтбокс — інакше на ноутбуці без миші з нього не вийти
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  const rows = useMemo(() => (payload ? payload[tab] : []), [payload, tab]);

  const cities = useMemo(
    () => countBy(rows, (r) => String(r['Місто / район'] ?? '')).map(([c]) => c),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = out.filter((r) =>
        [
          r['Назва компанії'], r['Тип діяльності'], r['Сайт'], r['Докази мови'],
          r['Телефон'], r['Опис для продажника'], r['Техстек'],
        ]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    if (cityFilter) out = out.filter((r) => String(r['Місто / район'] ?? '') === cityFilter);
    if (statusFilter) {
      out = out.filter((r) =>
        statusFilter === '__empty'
          ? !String(r['Статус'] ?? '').trim()
          : String(r['Статус'] ?? '').trim() === statusFilter,
      );
    }

    return [...out].sort((a, b) => {
      // Найгірший сайт спершу — це і є найкращий лід
      if (sortKey === 'Оцінка сайту 1-10') return num(a[sortKey]) - num(b[sortKey]);
      if (sortKey === 'Рейтинг / відгуки') return num(b[sortKey]) - num(a[sortKey]);
      if (sortKey === 'Мовний скор') return num(b[sortKey]) - num(a[sortKey]);
      if (sortKey === 'Складність розробки') {
        return countStars(b['Складність розробки']) - countStars(a['Складність розробки']);
      }
      return String(a['Назва компанії'] ?? '').localeCompare(String(b['Назва компанії'] ?? ''));
    });
  }, [rows, search, cityFilter, statusFilter, sortKey]);

  const onStatusChange = useCallback(
    async (lead: Lead, status: string) => {
      /*
       * Запобіжник від запису, якого ніхто не робив.
       *
       * Selector, отримавши value, якого немає серед options, «виправляє» його
       * і викликає onChange сам — просто на монтуванні. Одне відкриття панелі
       * тихо відправляло update у таблицю: статус затирався, а Apps Script
       * дописував поточну дату й ім'я. Виявилось при першому ж візуальному
       * прогоні — рядок ліда виявився переписаним о 14:03, хоча ніхто нічого
       * не натискав.
       *
       * Тому: зміна, що дорівнює поточному значенню, у мережу не йде.
       */
      if (status === String(lead['Статус'] ?? '')) return;

      setSaving(lead.place_id);
      // Оптимістично: продажник бачить зміну миттєво, а не через секунду очікування
      setPayload((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        next[tab] = next[tab].map((r) =>
          r.place_id === lead.place_id ? { ...r, Статус: status, 'Хто веде': user ?? '' } : r,
        );
        return next;
      });
      try {
        await updateLead(code, lead.place_id, { status });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [code, tab, user],
  );

  /* ───────────────────────── вхід ───────────────────────── */
  if (!user) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
        <Card width={420}>
          <div style={{ padding: 32, display: 'grid', gap: 18 }}>
            <div style={{ ...row(10) }}>
              <span style={{ color: 'var(--color-accent)' }}>
                <Lock size={26} />
              </span>
              <Heading level={1}>Панель лідів</Heading>
            </div>
            <Text type="supporting">
              Введи свій особистий код доступу. Він визначає, ким підписані твої статуси.
            </Text>
            <TextInput label="Код доступу" type="password" value={code} onChange={setCode} />
            {error && <Banner status="error" title={error} />}
            <Button
              label={busy ? 'Перевіряю…' : 'Увійти'}
              variant="primary"
              onClick={() => void login(code)}
              isDisabled={busy || !code}
            />
          </div>
        </Card>
      </div>
    );
  }

  /* ───────────────────────── панель ───────────────────────── */
  const statuses = payload?.statuses ?? [];

  const untouched = rows.filter((r) => !String(r['Статус'] ?? '').trim()).length;
  const hot = rows.filter((r) => num(r['Оцінка сайту 1-10']) <= 3).length;
  const avgScore = rows.length
    ? (rows.reduce((s, r) => s + num(r['Оцінка сайту 1-10']), 0) / rows.length).toFixed(1)
    : '—';

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '24px 20px 60px' }}>
      <div style={{ ...row(), justifyContent: 'space-between' }}>
        <div style={row(10)}>
          <span style={{ color: 'var(--color-accent)' }}>
            <Target size={28} />
          </span>
          <Heading level={1}>Панель лідів</Heading>
        </div>
        <div style={row(10)}>
          <Badge variant="info" label={user} />
          <Button
            label="Вийти"
            variant="secondary"
            size="sm"
            icon={<Logout size={16} />}
            onClick={() => {
              clearCode();
              setUser(null);
              setPayload(null);
              setCode('');
            }}
          />
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 12 }}>
          <Banner status="error" title={error} />
        </div>
      )}

      <div style={{ ...row(8), marginTop: 20 }}>
        {(Object.keys(TAB_LABEL) as TabKey[]).map((k) => (
          <Button
            key={k}
            label={`${TAB_LABEL[k]} (${payload?.[k].length ?? 0})`}
            size="md"
            variant={tab === k ? 'primary' : 'secondary'}
            onClick={() => setTab(k)}
          />
        ))}
        <Button
          label={busy ? 'Оновлюю…' : 'Оновити'}
          size="md"
          variant="ghost"
          icon={<Refresh size={16} />}
          onClick={() => void login(code)}
          isDisabled={busy}
        />
      </div>

      {/* ── зведення числами: що взагалі лежить у цій вкладці ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
          marginTop: 20,
        }}
      >
        <Kpi icon={<Users size={20} />} label="Усього" value={String(rows.length)} tone="var(--color-accent)" />
        <Kpi icon={<Clock size={20} />} label="Не опрацьовано" value={String(untouched)} tone="#d97706" />
        <Kpi icon={<AlertTriangle size={20} />} label="Гарячих (сайт ≤3)" value={String(hot)} tone="#059669" />
        <Kpi icon={<Gauge size={20} />} label="Середня оцінка сайту" value={avgScore} tone="#7c3aed" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 16,
          margin: '20px 0',
        }}
      >
        <Card>
          <div style={{ padding: 18 }}>
            <StatusDonut rows={rows} statuses={statuses} title="Воронка статусів" />
          </div>
        </Card>
        <Card>
          <div style={{ padding: 18 }}>
            <ScoreHistogram rows={rows} title="Оцінка сайту" />
          </div>
        </Card>
        <Card>
          <div style={{ padding: 18 }}>
            <BarList
              data={countBy(rows, (r) => String(r['Місто / район'] ?? ''))}
              title="Міста"
              color="#0891b2"
            />
          </div>
        </Card>
        <Card>
          <div style={{ padding: 18 }}>
            <BarList
              data={countBy(rows, (r) => String(r['Тип діяльності'] ?? ''))}
              title="Ніші"
              color="#7c3aed"
            />
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ padding: 18, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <TextInput
              label="Пошук"
              placeholder="назва, сайт, телефон, опис, техстек…"
              value={search}
              onChange={setSearch}
              hasClear
            />
          </div>
          <div style={{ minWidth: 190 }}>
            <Selector
              label="Місто"
              value={cityFilter}
              onChange={setCityFilter}
              options={[{ value: '', label: 'Усі' }, ...cities.map((c) => ({ value: c, label: c }))]}
            />
          </div>
          <div style={{ minWidth: 190 }}>
            <Selector
              label="Статус"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: '', label: 'Усі' },
                { value: '__empty', label: 'Не опрацьовані' },
                ...statuses.map((s) => ({ value: s, label: s })),
              ]}
            />
          </div>
          <div style={{ minWidth: 220 }}>
            <Selector
              label="Сортувати"
              value={sortKey}
              onChange={setSortKey}
              options={[
                { value: 'Оцінка сайту 1-10', label: 'Найгірший сайт спершу' },
                { value: 'Рейтинг / відгуки', label: 'Найбільше відгуків' },
                { value: 'Мовний скор', label: 'Найсильніший сигнал' },
                { value: 'Складність розробки', label: 'Найбільший проєкт' },
                { value: 'Назва компанії', label: 'За назвою' },
              ]}
            />
          </div>
        </div>
      </Card>

      <div style={{ ...row(8), margin: '16px 2px' }}>
        <Text type="supporting">
          Показано {filtered.length} з {rows.length}
          {loadedAt &&
            ` · дані на ${loadedAt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`}
        </Text>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {filtered.map((lead) => (
          <LeadCard
            key={lead.place_id}
            lead={lead}
            statuses={statuses}
            highlight={search.trim()}
            saving={saving === lead.place_id}
            onStatus={(s) => void onStatusChange(lead, s)}
            onZoom={() => setZoom({ id: lead.place_id, name: String(lead['Назва компанії'] ?? '') })}
          />
        ))}
      </div>

      {zoom && <Lightbox id={zoom.id} name={zoom.name} onClose={() => setZoom(null)} />}
    </div>
  );
}

/* ───────────────────────── зведена плитка ───────────────────────── */

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card>
      <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span
          style={{
            color: tone,
            background: `color-mix(in srgb, ${tone} 14%, transparent)`,
            borderRadius: 10,
            padding: 9,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {icon}
        </span>
        {/* display="block" обов'язковий: Text за замовчуванням inline,
            і без нього число з підписом злипались у «64Усього» */}
        <div>
          <Text type="display-3" as="div" display="block" weight="bold">
            {value}
          </Text>
          <Text type="supporting" as="div" display="block">
            {label}
          </Text>
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────── картка ліда ───────────────────────── */

function LeadCard({
  lead,
  statuses,
  saving,
  highlight,
  onStatus,
  onZoom,
}: {
  lead: Lead;
  statuses: string[];
  saving: boolean;
  highlight: string;
  onStatus: (s: string) => void;
  onZoom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hasShot, setHasShot] = useState(true);

  const score = num(lead['Оцінка сайту 1-10']);
  /*
   * Зелене = поганий сайт = гарячий лід.
   * Шкала навмисно «перевернута» відносно звичної: продажнику потрібні саме ті,
   * у кого сайт найгірший, тож підсвічуємо їх як позитив.
   */
  const scoreVariant = score <= 3 ? 'green' : score <= 6 ? 'orange' : 'neutral';
  const scoreColor = score <= 3 ? '#059669' : score <= 6 ? '#d97706' : '#64748b';

  const status = String(lead['Статус'] ?? '');

  /*
   * Невідомий статус подаємо як варіант, а не даємо Selector'у його «виправити».
   *
   * Так у списку видно навіть сміття, що потрапило в колонку збоку (саме так
   * виявився зсув колонок після міграції), і продажник розуміє, що там щось не
   * те, замість того щоб бачити порожнє поле.
   */
  const statusOptions = [
    { value: '', label: 'Не опрацьовано' },
    ...statuses.map((s) => ({ value: s, label: s })),
    ...(status && !statuses.includes(status) ? [{ value: status, label: `⚠ ${status}` }] : []),
  ];

  const { rating, reviews } = parseRating(lead['Рейтинг / відгуки']);
  const [psiMobile, psiDesktop] = parsePsi(lead['PSI моб / деск']);
  const stars = countStars(lead['Складність розробки']);
  const brief = String(lead['Опис для продажника'] ?? '');
  const site = String(lead['Сайт'] ?? '');
  const phone = String(lead['Телефон'] ?? '');
  const email = String(lead['Email'] ?? '');

  const problems: string[] = [];
  if (lead['Адаптивний'] === 'НІ') problems.push('не адаптивний');
  if (lead['HTTPS'] === 'НІ') problems.push('без HTTPS');
  if (psiMobile != null && psiMobile < 40) problems.push(`PSI моб ${psiMobile}`);

  return (
    <Card>
      <div style={{ padding: 18 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* ── скріншот: найшвидший спосіб зрозуміти, про що взагалі мова ── */}
          {hasShot && (
            <div
              className="shot-frame"
              style={{ width: 104, height: 150 }}
              onClick={onZoom}
              title="Збільшити"
            >
              <img
                className="shot"
                src={shotUrl(lead.place_id, 'mobile')}
                alt=""
                loading="lazy"
                onError={() => setHasShot(false)}
              />
            </div>
          )}

          <div style={{ flex: '1 1 340px', minWidth: 280 }}>
            <div style={row(8)}>
              <Text type="large" weight="bold">
                <Mark text={String(lead['Назва компанії'] ?? '')} q={highlight} />
              </Text>
              <Badge variant={scoreVariant} label={`сайт ${lead['Оцінка сайту 1-10']}/10`} />
              {lead['Тир'] && lead['Тир'] !== '—' && (
                <Badge variant="neutral" label={`тир ${lead['Тир']}`} />
              )}
            </div>

            {/* ── рядок фактів з іконками ── */}
            <div style={{ ...row(14), marginTop: 8, color: 'var(--color-text-secondary)' }}>
              <span style={row(5)}>
                <Tag size={15} />
                <Text type="supporting">{String(lead['Тип діяльності'] ?? '—')}</Text>
              </span>
              <span style={row(5)}>
                <MapPin size={15} />
                <Text type="supporting">{String(lead['Місто / район'] ?? '—')}</Text>
              </span>
              {rating != null && (
                <span style={row(5)}>
                  <Stars value={rating} size={15} />
                  <Text type="supporting">
                    {rating} · {reviews} відгуків
                  </Text>
                </span>
              )}
            </div>

            {/* ── складність у зірках ── */}
            {stars > 0 && (
              <div style={{ ...row(8), marginTop: 8 }}>
                <span style={row(5)}>
                  <Layers size={15} />
                  <Text type="supporting">Складність:</Text>
                </span>
                <Stars value={stars} size={16} color="#2563eb" />
                <Text type="supporting">{difficultyLabel(lead['Складність розробки'])}</Text>
              </div>
            )}

            {/* ── проблеми одним поглядом ── */}
            {problems.length > 0 && (
              <div style={{ ...row(6), marginTop: 10 }}>
                {problems.map((p) => (
                  <Chip key={p} text={p} />
                ))}
              </div>
            )}

            {/* ── контакти ── */}
            <div style={{ ...row(16), marginTop: 12 }}>
              {site && site !== '—' && (
                <a href={site} target="_blank" rel="noreferrer" style={row(6)}>
                  <Globe size={16} /> сайт <ExternalLink size={13} />
                </a>
              )}
              {lead['Google Maps'] && (
                <a href={String(lead['Google Maps'])} target="_blank" rel="noreferrer" style={row(6)}>
                  <MapPin size={16} /> Maps <ExternalLink size={13} />
                </a>
              )}
              {phone && phone !== '—' && (
                <a href={`tel:${phone.replace(/\s/g, '')}`} style={row(6)}>
                  <Phone size={16} /> {phone}
                </a>
              )}
              {email && email !== '—' && (
                <a href={`mailto:${email}`} style={row(6)}>
                  <Mail size={16} /> {email}
                </a>
              )}
            </div>
          </div>

          {/* ── права колонка: статус і швидкість ── */}
          <div style={{ minWidth: 240, display: 'grid', gap: 12 }}>
            <Selector
              label="Статус"
              value={status}
              onChange={onStatus}
              isDisabled={saving}
              options={statusOptions}
            />
            {lead['Хто веде'] && (
              <Text type="supporting" as="div" display="block">
                веде: <strong>{String(lead['Хто веде'])}</strong>
                {formatSheetDate(lead['Дата контакту']) &&
                  ` · ${formatSheetDate(lead['Дата контакту'])}`}
              </Text>
            )}

            {(psiMobile != null || psiDesktop != null) && (
              <div style={{ display: 'grid', gap: 8 }}>
                <PsiBar label="PSI мобільний" value={psiMobile} icon={<Smartphone size={14} />} />
                <PsiBar label="PSI десктоп" value={psiDesktop} icon={<Gauge size={14} />} />
              </div>
            )}
          </div>
        </div>

        {/* ── бриф: головне, що продажник читає перед дзвінком ── */}
        {brief && (
          <div className="brief">
            <Text type="body" as="div">
              <Mark text={brief} q={highlight} />
            </Text>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <Button
            label={open ? 'Згорнути' : 'Технічні деталі'}
            size="sm"
            variant="ghost"
            icon={<ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : undefined }} />}
            onClick={() => setOpen((v) => !v)}
          />
        </div>

        {open && (
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            <Row icon={<Users size={15} />} label="Чому вважаємо своїм" value={String(lead['Докази мови'] ?? '')} />
            <Row icon={<Tag size={15} />} label="Мова" value={String(lead['Мова'] ?? '')} />
            <Row icon={<AlertTriangle size={15} />} label="Чому така оцінка" value={String(lead['Причини оцінки'] ?? '')} />
            <Row icon={<Layers size={15} />} label="Техстек" value={String(lead['Техстек'] ?? '')} />
            <Row icon={<ShieldOff size={15} />} label="HTTPS" value={String(lead['HTTPS'] ?? '')} />
            <Row icon={<Smartphone size={15} />} label="Адаптивний" value={String(lead['Адаптивний'] ?? '')} />
            <Row icon={<Globe size={15} />} label="Соцмережі" value={String(lead['Соцмережі'] ?? '')} />
            {lead['Коментар'] && (
              <Row icon={<ImageIcon size={15} />} label="Коментар" value={String(lead['Коментар'])} />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ───────────────────────── дрібні складові ───────────────────────── */

/** Червоний чіп-попередження. Навмисно без Badge: тут потрібна іконка. */
function Chip({ text }: { text: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        color: '#dc2626',
        background: 'color-mix(in srgb, #dc2626 12%, transparent)',
        border: '1px solid color-mix(in srgb, #dc2626 30%, transparent)',
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: '0.82rem',
        fontWeight: 600,
      }}
    >
      <AlertTriangle size={13} />
      {text}
    </span>
  );
}

/**
 * PSI як смуга, а не число.
 *
 * «23» саме по собі нічого не означає для продажника, а заповнена на чверть
 * червона смуга поруч із майже повною зеленою читається без пояснень.
 */
function PsiBar({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
}) {
  if (value == null) return null;
  const variant = value < 40 ? 'error' : value < 70 ? 'warning' : 'success';
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div style={{ ...row(6), justifyContent: 'space-between' }}>
        <span style={{ ...row(5), color: 'var(--color-text-secondary)' }}>
          {icon}
          <Text type="supporting">{label}</Text>
        </span>
        <Text type="supporting" weight="bold">
          {value}
        </Text>
      </div>
      <ProgressBar label={label} value={value} max={100} variant={variant} isLabelHidden />
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  if (!value || value === '—') return null;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ ...row(6), minWidth: 200, color: 'var(--color-text-secondary)' }}>
        {icon}
        <Text type="supporting">{label}</Text>
      </span>
      <Text type="body" as="div">
        {value}
      </Text>
    </div>
  );
}

/** Підсвічує знайдений фрагмент. Порожній запит повертає текст як є. */
function Mark({ text, q }: { text: string; q: string }) {
  if (!q || q.length < 2) return <>{text}</>;
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${safe})`, 'ig'));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

/** Обидва скріни на весь екран: мобільний і десктопний поруч. */
function Lightbox({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  return (
    <div className="lightbox" onClick={onClose}>
      <div style={{ display: 'grid', gap: 14, justifyItems: 'center' }}>
        <div style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 600 }}>{name}</div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
          <img
            src={shotUrl(id, 'mobile')}
            alt="мобільна версія"
            style={{ maxHeight: '78vh', maxWidth: '90vw', borderRadius: 10, background: '#fff' }}
          />
          <img
            src={shotUrl(id, 'desktop')}
            alt="десктопна версія"
            style={{ maxHeight: '78vh', maxWidth: '90vw', borderRadius: 10, background: '#fff' }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
        <div style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>клік або Esc — закрити</div>
      </div>
    </div>
  );
}
