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
        document.title = 'ZUPIRUS Quant Lab — Institutional XAU/USD Quantitative Research & PDF Reports';
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          metaDesc.setAttribute(
            'content',
            'Institutional XAU/USD & COMEX Gold quantitative research platform. Verifiable Walk-Forward out-of-sample evidence, friction cost models, and downloadable PDF publications.'
          );
        }
        const metaKw = document.querySelector('meta[name="keywords"]');
        if (metaKw) {
          metaKw.setAttribute(
            'content',
            'ZUPIRUS Quant Lab, XAUUSD quantitative research, gold market microstructure, walk forward optimization, quant PDF reports, COMEX gold analysis'
          );
        }
      } else {
        document.title = 'ZUPIRUS Quant Lab — Phòng Nghiên Cứu Định Lượng Vàng XAU/USD & Báo Cáo PDF';
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          metaDesc.setAttribute(
            'content',
            'Nền tảng nghiên cứu định lượng độc lập chuyên sâu về vi cấu trúc thị trường Vàng XAU/USD & COMEX. Kiểm định Walk-Forward ngoài mẫu, mô hình chi phí ma sát thực tế và tải ấn phẩm PDF bản quyền.'
          );
        }
        const metaKw = document.querySelector('meta[name="keywords"]');
        if (metaKw) {
          metaKw.setAttribute(
            'content',
            'ZUPIRUS Quant Lab, nghiên cứu định lượng vàng, báo cáo định lượng XAUUSD, kiểm định walk forward ngoài mẫu, vi cấu trúc thị trường vàng, báo cáo pdf định lượng'
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
