import type { Lead, Tab } from './api';

export const activityLabels = (lead: Pick<Lead, 'Тип діяльності'>): string[] => {
  const labels = String(lead['Тип діяльності'] ?? '').split(';').map((s) => s.trim()).filter((s) => s && s !== '—');
  return labels.length ? [...new Set(labels)] : ['Не вказано'];
};

export const activityOptions = (rows: Lead[]): string[] =>
  [...new Set(rows.flatMap(activityLabels))].sort((a, b) => a.localeCompare(b, 'uk'));

export const compareActivities = (a: Lead, b: Lead): number =>
  activityLabels(a).join('; ').localeCompare(activityLabels(b).join('; '), 'uk') ||
  String(a['Назва компанії'] ?? '').localeCompare(String(b['Назва компанії'] ?? ''), 'uk');

export const archiveLast = (tabs: Tab[]): Tab[] => [...tabs].sort((a, b) =>
  Number(a.key === 'archive' || a.title === 'Архів') - Number(b.key === 'archive' || b.title === 'Архів'));
