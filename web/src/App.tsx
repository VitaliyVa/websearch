import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
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

type TabKey = 'leads' | 'manual' | 'noSite';

const TAB_LABEL: Record<TabKey, string> = {
  leads: 'Ліди',
  manual: 'Ручна перевірка',
  noSite: 'Без сайту',
};

const row = (gap = 12): React.CSSProperties => ({
  display: 'flex',
  gap,
  alignItems: 'center',
  flexWrap: 'wrap',
});

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

  const login = useCallback(async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const { user: u, data } = await fetchLeads(c);
      setUser(u);
      setPayload(data);
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
        [r['Назва компанії'], r['Тип діяльності'], r['Сайт'], r['Докази мови'], r['Телефон']]
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

    const num = (v: unknown) => {
      const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    return [...out].sort((a, b) => {
      // Найгірший сайт спершу — це і є найкращий лід
      if (sortKey === 'Оцінка сайту 1-10') return num(a[sortKey]) - num(b[sortKey]);
      if (sortKey === 'Рейтинг / відгуки') return num(b[sortKey]) - num(a[sortKey]);
      if (sortKey === 'Мовний скор') return num(b[sortKey]) - num(a[sortKey]);
      return String(a['Назва компанії'] ?? '').localeCompare(String(b['Назва компанії'] ?? ''));
    });
  }, [rows, search, cityFilter, statusFilter, sortKey]);

  const onStatusChange = useCallback(
    async (lead: Lead, status: string) => {
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
        <Card width={380}>
          <div style={{ padding: 24, display: 'grid', gap: 16 }}>
            <Heading level={1}>Панель лідів</Heading>
            <Text type="supporting">Введи свій код доступу</Text>
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

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: 20 }}>
      <div style={{ ...row(), justifyContent: 'space-between' }}>
        <Heading level={1}>Панель лідів</Heading>
        <div style={row(8)}>
          <Badge variant="info" label={user} />
          <Button
            label="Вийти"
            variant="secondary"
            size="sm"
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

      <div style={{ ...row(8), marginTop: 16 }}>
        {(Object.keys(TAB_LABEL) as TabKey[]).map((k) => (
          <Button
            key={k}
            label={`${TAB_LABEL[k]} (${payload?.[k].length ?? 0})`}
            size="sm"
            variant={tab === k ? 'primary' : 'secondary'}
            onClick={() => setTab(k)}
          />
        ))}
        <Button
          label={busy ? 'Оновлюю…' : 'Оновити'}
          size="sm"
          variant="ghost"
          onClick={() => void login(code)}
          isDisabled={busy}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          margin: '20px 0',
        }}
      >
        <Card>
          <div style={{ padding: 16 }}>
            <StatusDonut rows={rows} statuses={statuses} title="Воронка статусів" />
          </div>
        </Card>
        <Card>
          <div style={{ padding: 16 }}>
            <ScoreHistogram rows={rows} title="Оцінка сайту" />
          </div>
        </Card>
        <Card>
          <div style={{ padding: 16 }}>
            <BarList
              data={countBy(rows, (r) => String(r['Місто / район'] ?? ''))}
              title="Міста"
              color="#0891b2"
            />
          </div>
        </Card>
        <Card>
          <div style={{ padding: 16 }}>
            <BarList
              data={countBy(rows, (r) => String(r['Тип діяльності'] ?? ''))}
              title="Ніші"
              color="#7c3aed"
            />
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ minWidth: 240, flex: 1 }}>
            <TextInput
              label="Пошук"
              placeholder="назва, сайт, телефон, докази…"
              value={search}
              onChange={setSearch}
            />
          </div>
          <div style={{ minWidth: 180 }}>
            <Selector
              label="Місто"
              value={cityFilter}
              onChange={setCityFilter}
              options={[{ value: '', label: 'Усі' }, ...cities.map((c) => ({ value: c, label: c }))]}
            />
          </div>
          <div style={{ minWidth: 180 }}>
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
          <div style={{ minWidth: 200 }}>
            <Selector
              label="Сортувати"
              value={sortKey}
              onChange={setSortKey}
              options={[
                { value: 'Оцінка сайту 1-10', label: 'Найгірший сайт спершу' },
                { value: 'Рейтинг / відгуки', label: 'Найбільше відгуків' },
                { value: 'Мовний скор', label: 'Найсильніший сигнал' },
                { value: 'Назва компанії', label: 'За назвою' },
              ]}
            />
          </div>
        </div>
      </Card>

      <div style={{ margin: '12px 0', fontSize: 13, opacity: 0.7 }}>
        Показано {filtered.length} з {rows.length}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {filtered.map((lead) => (
          <LeadCard
            key={lead.place_id}
            lead={lead}
            statuses={statuses}
            saving={saving === lead.place_id}
            onStatus={(s) => void onStatusChange(lead, s)}
          />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── картка ліда ───────────────────────── */

function LeadCard({
  lead,
  statuses,
  saving,
  onStatus,
}: {
  lead: Lead;
  statuses: string[];
  saving: boolean;
  onStatus: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const score = Number(lead['Оцінка сайту 1-10']);
  /*
   * Зелене = поганий сайт = гарячий лід.
   * Шкала навмисно «перевернута» відносно звичної: продажнику потрібні саме ті,
   * у кого сайт найгірший, тож підсвічуємо їх як позитив.
   */
  const scoreVariant = score <= 3 ? 'green' : score <= 6 ? 'orange' : 'neutral';
  const status = String(lead['Статус'] ?? '');

  return (
    <Card>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px', minWidth: 260 }}>
            <div style={row(8)}>
              <Text type="label">{String(lead['Назва компанії'] ?? '')}</Text>
              <Badge variant={scoreVariant} label={`сайт ${lead['Оцінка сайту 1-10']}/10`} />
              {lead['Тир'] && lead['Тир'] !== '—' && (
                <Badge variant="neutral" label={`тир ${lead['Тир']}`} />
              )}
              {lead['Адаптивний'] === 'НІ' && <Badge variant="error" label="не адаптивний" />}
              {lead['HTTPS'] === 'НІ' && <Badge variant="error" label="без HTTPS" />}
            </div>

            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
              {String(lead['Тип діяльності'] ?? '')} · {String(lead['Місто / район'] ?? '')} ·{' '}
              {String(lead['Рейтинг / відгуки'] ?? '')}
            </div>

            <div style={{ ...row(12), marginTop: 8, fontSize: 13 }}>
              {lead['Сайт'] && lead['Сайт'] !== '—' && (
                <a href={String(lead['Сайт'])} target="_blank" rel="noreferrer">
                  сайт ↗
                </a>
              )}
              {lead['Google Maps'] && (
                <a href={String(lead['Google Maps'])} target="_blank" rel="noreferrer">
                  Google Maps ↗
                </a>
              )}
              {lead['Телефон'] && lead['Телефон'] !== '—' && (
                <a href={`tel:${String(lead['Телефон']).replace(/\s/g, '')}`}>
                  {String(lead['Телефон'])}
                </a>
              )}
              {lead['Email'] && lead['Email'] !== '—' && (
                <a href={`mailto:${lead['Email']}`}>{String(lead['Email'])}</a>
              )}
            </div>
          </div>

          <div style={{ minWidth: 220 }}>
            <Selector
              label="Статус"
              value={status}
              onChange={onStatus}
              isDisabled={saving}
              options={[
                { value: '', label: 'Не опрацьовано' },
                ...statuses.map((s) => ({ value: s, label: s })),
              ]}
            />
            {lead['Хто веде'] && (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                веде: {String(lead['Хто веде'])}
                {lead['Дата контакту'] ? ` · ${String(lead['Дата контакту'])}` : ''}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <Button
            label={open ? 'Згорнути' : 'Деталі'}
            size="sm"
            variant="ghost"
            onClick={() => setOpen((v) => !v)}
          />
        </div>

        {open && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6, fontSize: 13 }}>
            <Row label="Чому вважаємо своїм" value={String(lead['Докази мови'] ?? '')} />
            <Row label="Мова" value={String(lead['Мова'] ?? '')} />
            <Row label="Чому такий сайт" value={String(lead['Причини оцінки'] ?? '')} />
            <Row label="Техстек" value={String(lead['Техстек'] ?? '')} />
            <Row label="PSI моб / деск" value={String(lead['PSI моб / деск'] ?? '')} />
            <Row label="Оцінка робіт" value={String(lead['Годин розробки'] ?? '')} />
            <Row label="Соцмережі" value={String(lead['Соцмережі'] ?? '')} />
          </div>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value || value === '—') return null;
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ minWidth: 170, opacity: 0.6 }}>{label}</div>
      <div style={{ flex: 1 }}>{value}</div>
    </div>
  );
}
