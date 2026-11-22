import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { vi, type TranslationType } from './vi';
import { en } from './en';
import { api } from '../api/client';

export type Language = 'vi' | 'en';

interface LanguageContextProps {
  lang: Language;
  setLang: (lang: Language) => void;
  t: TranslationType;
  toggleLang: () => void;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

const STORAGE_KEY = 'zupirus_lang';

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'vi' || saved === 'en') {
        return saved;
      }
      const navLang = (navigator.language || '').toLowerCase();
      if (navLang.startsWith('vi')) {
        return 'vi';
      }
      return 'en';
    }
    return 'vi';
  });

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newLang);
      document.documentElement.lang = newLang;
      // Persist to backend if authenticated (silent background call)
      api.patch('/api/v1/auth/language', { language: newLang }).catch(() => {
        // Ignore unauthenticated or network errors
      });
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'vi' ? 'en' : 'vi');
  }, [lang, setLang]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const t = lang === 'en' ? en : vi;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, toggleLang }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextProps => {
  const context = useContext(LanguageContext);
  if (!context) {
    return {
      lang: 'vi',
      setLang: () => {},
      toggleLang: () => {},
      t: vi,
    };
  }
  return context;
};
