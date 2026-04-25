import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'mysurflife_theme';
const VALID_PREFERENCES = ['auto', 'ocean', 'dawn', 'daylight'];
const DEFAULT_PREFERENCE = 'ocean';

function resolveTheme(pref) {
  if (pref === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'ocean';
  }
  return pref;
}

const ThemeContext = createContext({
  theme: DEFAULT_PREFERENCE,
  preference: DEFAULT_PREFERENCE,
  setTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID_PREFERENCES.includes(stored) ? stored : DEFAULT_PREFERENCE;
  });

  const activeTheme = resolveTheme(preference);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme);
  }, [activeTheme]);

  // When "auto", track system color-scheme changes in real time
  useEffect(() => {
    if (preference !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      document.documentElement.setAttribute('data-theme', resolveTheme('auto'));
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const setTheme = (value) => {
    if (!VALID_PREFERENCES.includes(value)) return;
    localStorage.setItem(STORAGE_KEY, value);
    setPreferenceState(value);
  };

  return (
    <ThemeContext.Provider value={{ theme: activeTheme, preference, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
