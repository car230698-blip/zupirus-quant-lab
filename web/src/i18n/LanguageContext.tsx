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
        localStorage.setItem('zupirus_geo_lang', qLang);
      } catch {}
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
        document.title = 'ZUPIRUS — Institutional Gold (XAU/USD) & Forex Cloud MT5 Quant Trading OS';
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          metaDesc.setAttribute(
            'content',
            'Zero-VPS Cloud MT5 quantitative trading system for Gold (XAU/USD) & Forex. 4-layer Fail-Closed capital shield engineered for FTMO, The5ers & FundedNext prop firms.'
          );
        }
        const metaKw = document.querySelector('meta[name="keywords"]');
        if (metaKw) {
          metaKw.setAttribute(
            'content',
            'ZUPIRUS, gold trading bot XAUUSD, automated forex trading, cloud MT5 zero VPS, pass FTMO challenge, The5ers, FundedNext, prop firm capital shield, quantitative gold trading'
          );
        }
      } else {
        document.title = 'ZUPIRUS — Bot Trade Vàng XAU/USD & Forex Cloud MT5 Chuẩn Quỹ';
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          metaDesc.setAttribute(
            'content',
            'Bot trade định lượng Vàng XAU/USD & Forex (EUR/USD, GBP/USD, USD/JPY) trên Cloud MT5 không cần VPS. 4 lớp giáp Fail-Closed chuẩn quỹ FTMO, The5ers, FundedNext. Kích hoạt SePay 24/7.'
          );
        }
        const metaKw = document.querySelector('meta[name="keywords"]');
        if (metaKw) {
          metaKw.setAttribute(
            'content',
            'ZUPIRUS, bot trade vàng XAUUSD, bot trade forex, EURUSD, GBPUSD, USDJPY, Cloud MT5 không cần VPS, pass quỹ FTMO, The5ers, FundedNext, Prop Firm Guard, copy trade MT5 tự động, giao dịch định lượng XAU/USD'
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
