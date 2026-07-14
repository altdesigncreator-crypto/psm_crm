import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Lang } from '@/lib/translations';
import { t as translate } from '@/lib/translations';

interface TranslationContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const TranslationContext = createContext<TranslationContextType>({
  lang: 'en',
  setLang: () => {},
  t: (key: string) => key,
});

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  // English on first use; Myanmar only when the user explicitly chose it.
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('crm-lang') as Lang;
    return saved === 'mm' ? 'mm' : 'en';
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem('crm-lang', newLang);
  }, []);

  const t = useCallback(
    (key: string) => translate(key, lang),
    [lang]
  );

  return (
    <TranslationContext.Provider value={{ lang, setLang, t }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within TranslationProvider');
  }
  return ctx;
}
