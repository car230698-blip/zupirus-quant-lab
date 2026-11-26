import React from 'react';
import { QuantReportCatalogAndLibrary } from '../../components/reports/QuantReportCatalogAndLibrary';
import { useLanguage } from '../../i18n/LanguageContext';

export interface UserCatalogPageProps {
  onNavigate: (to: string) => void;
}

export const UserCatalogPage: React.FC<UserCatalogPageProps> = ({ onNavigate }) => {
  const { lang } = useLanguage();

  return (
    <div className="space-y-6">
      <div className="quant-heading">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-wider text-[#12B5A6]">
            {lang === 'en' ? 'CUSTOMER PORTAL · PUBLICATIONS' : 'CỔNG KHÁCH HÀNG · DANH MỤC'}
          </div>
          <h1>
            {lang === 'en'
              ? 'XAU/USD Quantitative Research Catalog'
              : 'Danh Mục Ấn Phẩm Nghiên Cứu Định Lượng'}
          </h1>
          <p className="text-sm text-slate-400 m-0">
            {lang === 'en'
              ? 'Review out-of-sample statistics, read free sample PDFs, and purchase individual reports via USDT.'
              : 'Đối chiếu số liệu Walk-Forward, đọc bản mẫu miễn phí và mở khóa báo cáo PDF đầy đủ bằng USDT.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/portal/library')}
          className="quant-btn-secondary text-xs"
        >
          {lang === 'en' ? 'Go to My Library →' : 'Mở Thư Viện Đã Mua →'}
        </button>
      </div>

      <QuantReportCatalogAndLibrary
        mode="portal"
        initialSection="catalog"
        onUnlockedLibrary={() => onNavigate('/portal/library')}
      />
    </div>
  );
};
