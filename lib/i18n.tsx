'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Locale = 'zh' | 'en';

type I18nContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (zh: string, en: string) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  setLocale: () => {},
  t: (zh) => zh,
});

const STORAGE_KEY = 'ecom_ai_locale';

function readSaved(): Locale {
  if (typeof window === 'undefined') return 'zh';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'en' ? 'en' : 'zh';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleRaw] = useState<Locale>(readSaved);

  const setLocale = useCallback((l: Locale) => {
    setLocaleRaw(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback(
    (zh: string, en: string) => (locale === 'en' ? en : zh),
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
