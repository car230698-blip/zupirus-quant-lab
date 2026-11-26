import React from 'react';
import { UserBillingSection } from '../../components/reports/UserBillingSection';
import { useLanguage } from '../../i18n/LanguageContext';

export interface UserBillingPageProps {
  onNavigate: (to: string) => void;
}

export const UserBillingPage: React.FC<UserBillingPageProps> = ({ onNavigate }) => {
  const { lang } = useLanguage();

  return (
    <div className="space-y-6">
      <div className="quant-heading">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6]">
            {lang === 'en' ? 'CUSTOMER PORTAL · BILLING' : 'CỔNG KHÁCH HÀNG · ĐƠN HÀNG'}
          </div>
          <h1>{lang === 'en' ? 'Orders, Receipts & Referrals' : 'Đơn Hàng, Biên Lai & Giới Thiệu'}</h1>
          <p className="text-sm text-slate-400 m-0">
            {lang === 'en'
              ? 'View your USDT transaction receipts and manage referral invite links.'
              : 'Tra cứu biên lai thanh toán USDT và quản lý mã chia sẻ thư viện.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/portal/library')}
          className="quant-btn-secondary text-xs"
        >
          {lang === 'en' ? 'My PDF Library →' : 'Về Thư Viện PDF →'}
        </button>
      </div>

      <UserBillingSection />
    </div>
  );
};
