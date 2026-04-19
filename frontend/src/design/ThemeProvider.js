import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'mysurflife_theme';
const VALID_THEMES = ['ocean', 'dawn', 'daylight'];
const DEFAULT_THEME = 'ocean';

const ThemeContext = createContext({ theme: DEFAULT_THEME, setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.includes(stored) ? stored : DEFAULT_THEME;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = (value) => {
    if (!VALID_THEMES.includes(value)) return;
    localStorage.setItem(STORAGE_KEY, value);
    setThemeState(value);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
