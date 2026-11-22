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
const MANUAL_KEY = 'zupirus_lang_manual';

export const detectInitialLanguage = (): Language => {
  if (typeof window === 'undefined') return 'en';

  // 1. Explicit user choice (manual click on VI/EN button) takes precedence
  const manual = localStorage.getItem(MANUAL_KEY);
  if (manual === 'vi' || manual === 'en') {
    return manual;
  }

  // 2. URL parameter override: ?lang=en or ?lang=vi
  try {
    const params = new URLSearchParams(window.location.search);
    const qLang = params.get('lang')?.toLowerCase();
    if (qLang === 'vi' || qLang === 'en') {
      return qLang;
    }
  } catch {}

  // 3. Cookie set by server based on Cloudflare CF-IPCountry / GeoIP
  try {
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === 'zupirus_geo_lang' && (v === 'vi' || v === 'en')) {
        return v as Language;
      }
    }
  } catch {}

  // 4. Foreign visitor detection via Browser Language & Timezone:
  // a) Browser Language check
  const navLang = (navigator.language || '').toLowerCase();
  const rawLangs = Array.isArray(navigator.languages) ? navigator.languages : [navLang];
  const hasVietnameseLang = navLang.startsWith('vi') || rawLangs.some(l => (l || '').toLowerCase().startsWith('vi'));

  // b) Physical Timezone check
  let isVnTimezone = false;
  try {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
    isVnTimezone = tz.includes('ho_chi_minh') || tz.includes('saigon');
  } catch {}

  // If visitor's browser is NOT Vietnamese OR visitor's timezone is outside Vietnam:
  // Automatically identify as Foreign Visitor and default to ENGLISH ('en')!
  if (!hasVietnameseLang || !isVnTimezone) {
    return 'en';
  }

  return 'vi';
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => detectInitialLanguage());

  const setLang = useCallback((newLang: Language, isManual: boolean = true) => {
    setLangState(newLang);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newLang);
      if (isManual) {
        localStorage.setItem(MANUAL_KEY, newLang);
      }
      document.documentElement.lang = newLang;
      // Persist to backend if authenticated (silent background call)
      api.patch('/api/v1/auth/language', { language: newLang }).catch(() => {
        // Ignore unauthenticated or network errors
      });
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'vi' ? 'en' : 'vi', true);
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
