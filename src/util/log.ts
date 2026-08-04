const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const ts = () => new Date().toTimeString().slice(0, 8);

export const log = {
  info: (msg: string) => console.log(`${C.dim}${ts()}${C.reset} ${msg}`),
  ok: (msg: string) => console.log(`${C.dim}${ts()}${C.reset} ${C.green}✓${C.reset} ${msg}`),
  warn: (msg: string) => console.log(`${C.dim}${ts()}${C.reset} ${C.yellow}!${C.reset} ${msg}`),
  err: (msg: string) => console.log(`${C.dim}${ts()}${C.reset} ${C.red}✗${C.reset} ${msg}`),
  step: (msg: string) => console.log(`\n${C.cyan}▸ ${msg}${C.reset}`),
  dim: (msg: string) => console.log(`${C.dim}  ${msg}${C.reset}`),
};

/**
 * Прогрес у один рядок.
 *
 * Пишемо не частіше разу на 500 мс і тільки в TTY. Раніше рядок ішов на кожен
 * елемент — 4297 записів по ~60 байт. Коли вивід перенаправлено в трубу, її
 * буфер заповнюється, і process.stdout.write блокує процес назовсім: CPU
 * горить, а роботи не видно. Саме так двічі зависав rescore.
 */
let lastProgressAt = 0;

export function progress(label: string, done: number, total: number) {
  const now = Date.now();
  const finished = done >= total;
  if (!finished && now - lastProgressAt < 500) return;
  lastProgressAt = now;

  const pct = total ? Math.round((done / total) * 100) : 0;

  if (!process.stdout.isTTY) {
    // Не-TTY (труба, файл, фоновий запуск): рідкісні рядки без \r
    if (finished || done % 500 === 0) console.log(`  ${label} ${done}/${total} (${pct}%)`);
    return;
  }

  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
  process.stdout.write(`\r  ${label} ${bar} ${done}/${total} (${pct}%)   `);
  if (finished) process.stdout.write('\n');
}
