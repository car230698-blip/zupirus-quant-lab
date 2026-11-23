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

export const detectInitialLanguage = (): Language => {
  if (typeof window === 'undefined') return 'en';

  // 1. URL parameter override: ?lang=en or ?lang=vi (for manual testing/overrides)
  try {
    const params = new URLSearchParams(window.location.search);
    const qLang = params.get('lang')?.toLowerCase();
    if (qLang === 'vi' || qLang === 'en') {
      return qLang;
    }
  } catch {}

  // 2. Cookie set by server based on Cloudflare CF-IPCountry / GeoIP
  try {
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === 'zupirus_geo_lang' && (v === 'vi' || v === 'en')) {
        return v as Language;
      }
    }
  } catch {}

  // 3. Fallback: Browser Language & Physical Timezone check
  const navLang = (navigator.language || '').toLowerCase();
  const rawLangs = Array.isArray(navigator.languages) ? navigator.languages : [navLang];
  const hasVietnameseLang = navLang.startsWith('vi') || rawLangs.some(l => (l || '').toLowerCase().startsWith('vi'));

  let isVnTimezone = false;
  try {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
    isVnTimezone = tz.includes('ho_chi_minh') || tz.includes('saigon');
  } catch {}

  // If visitor is outside Vietnam (either non-VN timezone or non-VN browser):
  if (!hasVietnameseLang || !isVnTimezone) {
    return 'en';
  }

  return 'vi';
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => detectInitialLanguage());

  // Automatic background IP Geo confirmation from server
  useEffect(() => {
    let active = true;
    api.get<{ language: Language; is_foreign: boolean; country?: string }>('/api/v1/auth/geo')
      .then((res) => {
        if (!active) return;
        if (res?.language && (res.language === 'en' || res.language === 'vi')) {
          setLangState(res.language);
          document.documentElement.lang = res.language;
          try {
            document.cookie = `zupirus_geo_lang=${res.language}; path=/; max-age=604800; SameSite=Lax`;
          } catch {}
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    if (typeof window !== 'undefined') {
      document.documentElement.lang = newLang;
      api.patch('/api/v1/auth/language', { language: newLang }).catch(() => {});
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
