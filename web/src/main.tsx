import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme, defineTheme } from '@astryxdesign/core/theme';

/*
 * Ці два імпорти обов'язкові.
 *
 * Без них компоненти XDS рендеряться зовсім без стилів — сірі прямокутники
 * замість кнопок і полів. Саме так виглядала перша версія панелі: розмітка
 * була правильна, а вигляду не було, бо базовий CSS бібліотеки не підключили.
 */
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';

import App from './App';
import './index.css';

/**
 * Тема панелі.
 *
 * Значення в парах [світла, темна] — компоненти самі перемикаються за
 * налаштуванням системи. Синій акцент навмисно спокійний: на екрані, де
 * продажник проводить години, кричущі кольори втомлюють.
 */
const theme = defineTheme({
  name: 'leads-panel',
  tokens: {
    '--color-accent': ['#2563eb', '#60a5fa'],
    '--color-background-body': ['#f6f7f9', '#0f1113'],
    '--color-background-surface': ['#ffffff', '#16181c'],
    '--color-background-card': ['#ffffff', '#1a1d21'],
    '--color-text-primary': ['#14161a', '#e8eaed'],
    '--color-text-secondary': ['#5b6270', '#9aa3b2'],
    '--color-border': ['#e3e6ea', '#2b2f36'],
    '--radius-container': '12px',
    '--radius-element': '8px',
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme theme={theme} mode="system">
      <App />
    </Theme>
  </StrictMode>,
);
