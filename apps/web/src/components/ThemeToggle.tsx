import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'parley-theme';
type Theme = 'paper' | 'ink';

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('ink', theme === 'ink');
}

export function initTheme(): void {
  applyTheme(localStorage.getItem(STORAGE_KEY) === 'ink' ? 'ink' : 'paper');
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem(STORAGE_KEY) === 'ink' ? 'ink' : 'paper',
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const next = theme === 'paper' ? 'ink' : 'paper';
  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors duration-120 hover:bg-row-hover hover:text-text-primary"
    >
      {theme === 'paper' ? (
        <Moon size={16} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Sun size={16} strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
}
