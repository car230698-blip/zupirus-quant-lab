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
      try {
        localStorage.setItem('zupirus_user_lang_pref', qLang);
        localStorage.setItem('zupirus_geo_lang', qLang);
      } catch {}
      return qLang;
    }
  } catch {}

  // 1b. User manual preference
  try {
    const userPref = localStorage.getItem('zupirus_user_lang_pref');
    if (userPref === 'vi' || userPref === 'en') {
      return userPref as Language;
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

  // 3. LocalStorage persistence
  try {
    const saved = localStorage.getItem('zupirus_geo_lang');
    if (saved === 'vi' || saved === 'en') {
      return saved as Language;
    }
  } catch {}

  // 4. Fallback: Browser Language & Physical Timezone check
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
    // If URL contains explicit ?lang= or user explicitly saved preference, do NOT override with GeoIP
    try {
      const params = new URLSearchParams(window.location.search);
      const qLang = params.get('lang')?.toLowerCase();
      if (qLang === 'vi' || qLang === 'en') return;
      const userPref = localStorage.getItem('zupirus_user_lang_pref');
      if (userPref === 'vi' || userPref === 'en') return;
    } catch {}

    let active = true;
    api.get<{ language: Language; is_foreign: boolean; country?: string }>('/api/v1/auth/geo')
      .then((res) => {
        if (!active) return;
        if (res?.language && (res.language === 'en' || res.language === 'vi')) {
          setLangState(res.language);
          document.documentElement.lang = res.language;
          try {
            const isZupirus = typeof window !== 'undefined' && window.location.hostname.endsWith('zupirus.com');
            const domainAttr = isZupirus ? '; domain=.zupirus.com' : '';
            document.cookie = `zupirus_geo_lang=${res.language}; path=/${domainAttr}; max-age=604800; SameSite=Lax`;
            localStorage.setItem('zupirus_geo_lang', res.language);
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
      try {
        localStorage.setItem('zupirus_user_lang_pref', newLang);
        localStorage.setItem('zupirus_geo_lang', newLang);
      } catch {}
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
      if (lang === 'en') {
        document.title = 'ZUPIRUS Quant Lab — Statistical studies of gold, forex, and indices';
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          metaDesc.setAttribute(
            'content',
            'Educational quantitative studies of gold, forex, and indices, sold as PDF guides. Free previews. No automated execution and no profit promise.'
          );
        }
        const metaKw = document.querySelector('meta[name="keywords"]');
        if (metaKw) {
          metaKw.setAttribute(
            'content',
            'ZUPIRUS, quantitative research, XAUUSD statistics, forex study PDF, trading methodology'
          );
        }
      } else {
        document.title = 'ZUPIRUS Quant Lab — Nghiên cứu thống kê vàng, ngoại hối và chỉ số';
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          metaDesc.setAttribute(
            'content',
            'Nghiên cứu thống kê vàng, ngoại hối và chỉ số, xuất bản dạng PDF. Có bản đọc thử. Không thực thi lệnh tự động và không cam kết lợi nhuận.'
          );
        }
        const metaKw = document.querySelector('meta[name="keywords"]');
        if (metaKw) {
          metaKw.setAttribute(
            'content',
            'ZUPIRUS, nghiên cứu định lượng, thống kê XAUUSD, PDF phương pháp giao dịch, vàng, ngoại hối'
          );
        }
      }
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
