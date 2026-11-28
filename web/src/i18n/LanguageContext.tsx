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

  // 1. Explicit path prefix override: /en or /en/...
  try {
    const pathname = window.location.pathname.toLowerCase();
    if (pathname === '/en' || pathname.startsWith('/en/')) {
      return 'en';
    }
  } catch { }

  // 2. URL parameter override: ?lang=en or ?lang=vi
  try {
    const params = new URLSearchParams(window.location.search);
    const qLang = params.get('lang')?.toLowerCase();
    if (qLang === 'vi' || qLang === 'en') {
      return qLang;
    }
  } catch { }

  // 3. Cookie set by server based on Cloudflare CF-IPCountry / GeoIP
  try {
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === 'zupirus_geo_lang' && (v === 'vi' || v === 'en')) {
        return v as Language;
      }
    }
  } catch { }

  // 4. Fallback: Browser Language & Physical Timezone check
  try {
    const navLang = (navigator.language || '').toLowerCase();
    const rawLangs = Array.isArray(navigator.languages) ? navigator.languages : [navLang];
    const hasVietnameseLang = navLang.startsWith('vi') || rawLangs.some(l => (l || '').toLowerCase().startsWith('vi'));

    let isVnTimezone = false;
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
    isVnTimezone = tz.includes('ho_chi_minh') || tz.includes('saigon');

    if (!hasVietnameseLang || !isVnTimezone) {
      return 'en';
    }
  } catch { }

  return 'vi';
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => detectInitialLanguage());

  // Automatic background IP Geo confirmation from server
  useEffect(() => {
    // If URL contains explicit ?lang= or path is /en, respect it
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname === '/en' || pathname.startsWith('/en/')) return;
      const params = new URLSearchParams(window.location.search);
      const qLang = params.get('lang')?.toLowerCase();
      if (qLang === 'vi' || qLang === 'en') return;
    } catch { }

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
          } catch { }
        }
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, []);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    if (typeof window !== 'undefined') {
      try {
        const isZupirus = window.location.hostname.endsWith('zupirus.com');
        const domainAttr = isZupirus ? '; domain=.zupirus.com' : '';
        document.cookie = `zupirus_geo_lang=${newLang}; path=/${domainAttr}; max-age=604800; SameSite=Lax`;
        localStorage.setItem('zupirus_geo_lang', newLang);
      } catch { }
      document.documentElement.lang = newLang;
      api.patch('/api/v1/auth/language', { language: newLang }).catch(() => { });
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'vi' ? 'en' : 'vi');
  }, [lang, setLang]);

  // Synchronize Google SEO metadata and Schema.org on language change
  useEffect(() => {
    if (typeof window === 'undefined') return;

    document.documentElement.lang = lang;

    // Helper to update or create meta tag
    const setMeta = (nameOrProp: 'name' | 'property', key: string, content: string) => {
      let tag = document.querySelector(`meta[${nameOrProp}="${key}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(nameOrProp, key);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    // Helper to update or create link tag
    const setLink = (rel: string, href: string) => {
      let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', rel);
        document.head.appendChild(link);
      }
      link.setAttribute('href', href);
    };

    if (lang === 'en') {
      document.title = 'ZUPIRUS Quant Lab — Quantitative Research Platform & Technical Analysis Reports';
      setLink('canonical', 'https://zupirus.com/en');

      const desc =
        'Independent quantitative research laboratory. Providing standardized 2–4 page technical analysis notes for individual traders and bespoke quantitative research studies for institutional clients.';
      const kw =
        'ZUPIRUS Quant Lab, quantitative research, technical analysis reports, institutional quant lab, walk-forward optimization, market microstructure, custom backtest, risk management';

      setMeta('name', 'description', desc);
      setMeta('name', 'keywords', kw);
      setMeta('property', 'og:locale', 'en_US');
      setMeta('property', 'og:locale:alternate', 'vi_VN');
      setMeta('property', 'og:url', 'https://zupirus.com/en');
      setMeta('property', 'og:title', 'ZUPIRUS Quant Lab — Quantitative Research Platform & Technical Analysis Reports');
      setMeta('property', 'og:description', desc);
      setMeta('name', 'twitter:title', 'ZUPIRUS Quant Lab — Quantitative Research Platform & Technical Analysis Reports');
      setMeta('name', 'twitter:description', desc);

      // English Schema.org
      const schemaScript = document.querySelector('script[type="application/ld+json"]');
      if (schemaScript) {
        schemaScript.textContent = JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Organization',
              '@id': 'https://zupirus.com/#organization',
              name: 'ZUPIRUS Quant Lab',
              url: 'https://zupirus.com/',
              logo: 'https://zupirus.com/favicon.svg',
              description: 'Independent quantitative research laboratory and bespoke institutional research services.',
            },
            {
              '@type': 'WebSite',
              '@id': 'https://zupirus.com/#website',
              url: 'https://zupirus.com/en',
              name: 'ZUPIRUS Quant Lab',
              inLanguage: ['en', 'vi'],
              publisher: { '@id': 'https://zupirus.com/#organization' },
            },
            {
              '@type': 'Service',
              name: 'Standardized Technical Analysis Notes (2–4 Pages)',
              serviceType: 'Technical Analysis Report',
              provider: { '@id': 'https://zupirus.com/#organization' },
              description: 'Standardized 2–4 page technical analysis reports by ticker, timeframe, and evaluation window, formatted for mobile reading.',
            },
            {
              '@type': 'Service',
              name: 'Bespoke Institutional Quantitative Research',
              serviceType: 'Bespoke Quantitative Research',
              provider: { '@id': 'https://zupirus.com/#organization' },
              description: 'In-depth institutional quantitative investigations with custom hypotheses, out-of-sample Walk-Forward verification, and dedicated artifact delivery.',
            },
            {
              '@type': 'FAQPage',
              mainEntity: [
                {
                  '@type': 'Question',
                  name: 'What quantitative research services does ZUPIRUS Quant Lab provide?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'We provide two core quantitative research products: (1) Standardized 2–4 page technical analysis reports for individual traders; (2) Bespoke quantitative research studies tailored to institutional client specifications with dedicated data, out-of-sample verification, and private artifact delivery.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'What is included in the individual technical analysis report?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Retail clients select a symbol, timeframe, and tracking horizon. The engine generates a concise 2–4 page standardized technical analysis report optimized for mobile and desktop reading.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'How does the bespoke institutional research workflow operate?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Institutional clients describe their specific research problem. ZUPIRUS proposes the testable hypothesis, asset basket, and evaluation window. Once scope and quote are confirmed, the quantitative engine executes and the admin reviews and delivers a private verified PDF/ZIP package with SHA-256 validation.',
                  },
                },
              ],
            },
          ],
        });
      }
    } else {
      document.title = 'ZUPIRUS Quant Lab — Nền Tảng Nghiên Cứu Định Lượng & Báo Cáo Phân Tích Kỹ Thuật';
      setLink('canonical', 'https://zupirus.com/');

      const desc =
        'Phòng nghiên cứu định lượng độc lập. Cung cấp báo cáo phân tích kỹ thuật chuẩn mực 2–4 trang cho nhà đầu tư cá nhân và dịch vụ nghiên cứu định lượng chuyên sâu theo bài toán riêng cho khách hàng tổ chức.';
      const kw =
        'ZUPIRUS Quant Lab, nghiên cứu định lượng, báo cáo phân tích kỹ thuật, quantitative research, phân tích định lượng XAUUSD, nghiên cứu theo yêu cầu, backtest ngoài mẫu, kiểm định định lượng tổ chức';

      setMeta('name', 'description', desc);
      setMeta('name', 'keywords', kw);
      setMeta('property', 'og:locale', 'vi_VN');
      setMeta('property', 'og:locale:alternate', 'en_US');
      setMeta('property', 'og:url', 'https://zupirus.com/');
      setMeta('property', 'og:title', 'ZUPIRUS Quant Lab — Nền Tảng Nghiên Cứu Định Lượng & Báo Cáo Phân Tích Kỹ Thuật');
      setMeta('property', 'og:description', desc);
      setMeta('name', 'twitter:title', 'ZUPIRUS Quant Lab — Nền Tảng Nghiên Cứu Định Lượng & Báo Cáo Phân Tích Kỹ Thuật');
      setMeta('name', 'twitter:description', desc);

      // Vietnamese Schema.org
      const schemaScript = document.querySelector('script[type="application/ld+json"]');
      if (schemaScript) {
        schemaScript.textContent = JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Organization',
              '@id': 'https://zupirus.com/#organization',
              name: 'ZUPIRUS Quant Lab',
              url: 'https://zupirus.com/',
              logo: 'https://zupirus.com/favicon.svg',
              description: 'Nền tảng nghiên cứu định lượng độc lập và dịch vụ nghiên cứu theo bài toán cho nhà đầu tư cá nhân và tổ chức.',
            },
            {
              '@type': 'WebSite',
              '@id': 'https://zupirus.com/#website',
              url: 'https://zupirus.com/',
              name: 'ZUPIRUS Quant Lab',
              inLanguage: ['vi', 'en'],
              publisher: { '@id': 'https://zupirus.com/#organization' },
            },
            {
              '@type': 'Service',
              name: 'Báo Cáo Phân Tích Kỹ Thuật Cá Nhân (2–4 trang)',
              serviceType: 'Technical Analysis Report',
              provider: { '@id': 'https://zupirus.com/#organization' },
              description: 'Bản phân tích kỹ thuật tiêu chuẩn 2–4 trang theo mã, khung thời gian và kỳ theo dõi, định dạng PDF tối ưu hiển thị cho thiết bị di động.',
            },
            {
              '@type': 'Service',
              name: 'Nghiên Cứu Định Lượng Theo Yêu Cầu Cho Tổ Chức',
              serviceType: 'Bespoke Quantitative Research',
              provider: { '@id': 'https://zupirus.com/#organization' },
              description: 'Nghiên cứu định lượng chuyên sâu theo đề bài của khách hàng tổ chức, kiểm định Walk-Forward ngoài mẫu, bộ dữ liệu và tệp bàn giao độc quyền.',
            },
            {
              '@type': 'FAQPage',
              mainEntity: [
                {
                  '@type': 'Question',
                  name: 'ZUPIRUS Quant Lab cung cấp những dịch vụ nghiên cứu nào?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Chúng tôi cung cấp hai dòng sản phẩm nghiên cứu: (1) Báo cáo phân tích kỹ thuật chuẩn mực 2–4 trang cho khách hàng cá nhân; (2) Dịch vụ nghiên cứu định lượng chuyên sâu theo đề bài riêng cho khách hàng tổ chức với dữ liệu, kiểm định ngoài mẫu OOS và bàn giao riêng.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'Báo cáo phân tích kỹ thuật cho khách hàng cá nhân gồm những gì?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Khách cá nhân lựa chọn mã tài sản, khung thời gian và kỳ theo dõi. Hệ thống sinh bản báo cáo kỹ thuật 2–4 trang theo mẫu chuẩn, trình bày khoa học, biểu đồ rõ ràng và tối ưu để đọc tốt trên điện thoại di động.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'Quy trình thực hiện bài toán nghiên cứu cho khách hàng tổ chức như thế nào?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Khách hàng tổ chức mô tả vấn đề cần giải quyết qua luồng trao đổi. ZUPIRUS đề xuất câu hỏi nghiên cứu, sự kiện, rổ mã và thời gian khảo nghiệm. Sau khi admin chốt phạm vi, báo giá và khách hàng xác nhận, engine định lượng sẽ chạy và admin duyệt bàn giao riêng bộ PDF/ZIP kèm mã đối soát SHA-256.',
                  },
                },
              ],
            },
          ],
        });
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
      setLang: () => { },
      toggleLang: () => { },
      t: vi,
    };
  }
  return context;
};
