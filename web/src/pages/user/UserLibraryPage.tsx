import React from 'react';
import { QuantReportCatalogAndLibrary } from '../../components/reports/QuantReportCatalogAndLibrary';
import { useLanguage } from '../../i18n/LanguageContext';

export interface UserLibraryPageProps {
  onNavigate: (to: string) => void;
}

export const UserLibraryPage: React.FC<UserLibraryPageProps> = ({ onNavigate }) => {
  const { lang } = useLanguage();

  return (
    <div className="space-y-6">
      <div className="quant-heading">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6]">
            {lang === 'en' ? 'CUSTOMER PORTAL · MY LIBRARY' : 'CỔNG KHÁCH HÀNG · THƯ VIỆN'}
          </div>
          <h1>{lang === 'en' ? 'My Purchased PDF Library' : 'Thư Viện Báo Cáo PDF Của Tôi'}</h1>
          <p className="text-sm text-slate-400 m-0">
            {lang === 'en'
              ? 'Download purchased PDF editions anytime and track pending USDT transactions.'
              : 'Tải xuống các ấn phẩm PDF bạn đã sở hữu và theo dõi các đơn thanh toán đang chờ.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/portal')}
          className="quant-btn-primary text-xs"
        >
          {lang === 'en' ? '+ New Research Request' : '+ Tạo Yêu Cầu Mới'}
        </button>
      </div>

      <QuantReportCatalogAndLibrary
        mode="portal"
        initialSection="library"
      />
    </div>
  );
};
