import { useEffect, useState } from 'react';

const STORAGE_KEY = 'parley-theme';

function applyTheme(light: boolean): void {
  document.documentElement.classList.toggle('light', light);
  document.documentElement.classList.toggle('dark', !light);
}

export function initTheme(): void {
  applyTheme(localStorage.getItem(STORAGE_KEY) === 'light');
}

export function ThemeToggle() {
  const [light, setLight] = useState(() => localStorage.getItem(STORAGE_KEY) === 'light');

  useEffect(() => {
    applyTheme(light);
    localStorage.setItem(STORAGE_KEY, light ? 'light' : 'dark');
  }, [light]);

  return (
    <button
      onClick={() => setLight((v) => !v)}
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      title={light ? 'Switch to dark theme' : 'Switch to light theme'}
      className="flex h-7 w-7 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
    >
      {light ? (
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M12 8.5A5.5 5.5 0 0 1 5.5 2 5.5 5.5 0 1 0 12 8.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M7 1v1.5M7 11.5V13M13 7h-1.5M2.5 7H1M11.2 2.8l-1 1M3.8 10.2l-1 1M11.2 11.2l-1-1M3.8 3.8l-1-1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
