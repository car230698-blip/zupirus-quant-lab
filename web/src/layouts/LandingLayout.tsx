import React, { useState, type ReactNode } from 'react';
import { BrandMark } from '../components/common/BrandMark';
import { useLanguage } from '../i18n/LanguageContext';
import { Menu, X } from 'lucide-react';

export interface LandingLayoutProps {
  onNavigate: (to: string) => void;
  children: ReactNode;
}

export const LandingLayout: React.FC<LandingLayoutProps> = ({ onNavigate, children }) => {
  const { lang, t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: '#overview', label: t.nav.about },
    { href: '#services', label: lang === 'vi' ? 'Sản phẩm nghiên cứu' : 'Research Services' },
    { href: '#method', label: t.nav.method },
    { href: '/guides', label: lang === 'vi' ? 'Tài liệu & Phương pháp' : 'Guides & Methodology' },
    { href: '#faq', label: t.nav.faq },
  ];

  return (
    <div className="min-h-screen bg-[#060A13] text-slate-100 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#060A13]/92 backdrop-blur-md">
        <div className="max-w-6xl mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-4">
          {/* Zone 1: BrandMark */}
          <BrandMark onClick={() => onNavigate('/')} />

          {/* Zone 2: Section Nav Links */}
          <nav className="hidden md:flex items-center gap-6" aria-label="Main navigation">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-slate-300 hover:text-white transition whitespace-nowrap shrink-0"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Zone 3: Customer Login + Portal CTA */}
          <div className="hidden md:flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="quant-btn-secondary min-h-[36px] py-1.5 px-3.5 text-xs whitespace-nowrap shrink-0"
            >
              {t.nav.login}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/portal')}
              className="quant-btn-primary min-h-[36px] py-1.5 px-4 text-xs whitespace-nowrap shrink-0"
            >
              {t.nav.launchPortal}
            </button>
          </div>

          {/* Mobile Actions */}
          <div className="flex md:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-[#0B1220] text-slate-200 cursor-pointer"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-800 bg-[#0B1220] px-4 py-4 space-y-3">
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800/60"
                >
                  {link.label}
                </a>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('/login');
                }}
                className="quant-btn-secondary text-xs"
              >
                {t.nav.login}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('/portal');
                }}
                className="quant-btn-primary text-xs"
              >
                {t.nav.shortPortal}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Clean Institutional Footer */}
      <footer className="border-t border-slate-800/80 bg-[#050810]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <BrandMark subtitle={t.footer.subnote} onClick={() => onNavigate('/')} />

            <nav className="flex flex-wrap items-center gap-6 text-xs text-slate-400">
              <a href="#method" className="hover:text-white transition">
                {t.footer.aboutLink}
              </a>
              <a href="#reports" className="hover:text-white transition">
                {t.footer.reportsLink}
              </a>
              <a href="/guides" className="hover:text-[#12B5A6] transition">
                {lang === 'vi' ? 'Tài liệu hướng dẫn' : 'Research Guides'}
              </a>
              <a href="#faq" className="hover:text-white transition">
                {t.footer.faqLink}
              </a>
              <button
                type="button"
                onClick={() => onNavigate('/portal')}
                className="text-[#12B5A6] font-medium hover:underline cursor-pointer"
              >
                {t.footer.portalLink}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/admin/login')}
                className="text-slate-500 hover:text-cyan-300 transition cursor-pointer font-mono"
              >
                {t.footer.adminLink}
              </button>
            </nav>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-[#0B1220]/70 p-4 text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-200">{t.footer.disclaimerTitle}</strong> {t.footer.disclaimerContent}
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-500 font-mono">
            <span>{t.footer.copyright}</span>
            <span>XAU/USD Quantitative Studies · Web-Only PDF Delivery</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
