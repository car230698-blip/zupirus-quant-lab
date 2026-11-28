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
            {lang === 'en' ? 'CUSTOMER PORTAL · ON-DEMAND QUANT LAB' : 'CỔNG KHÁCH HÀNG · NGHIÊN CỨU THEO YÊU CẦU'}
          </div>
          <h1>
            {lang === 'en'
              ? 'On-Demand Research & Analysis Lab'
              : 'Trung Tâm Phân Tích & Nghiên Cứu Định Lượng'}
          </h1>
          <p className="text-sm text-slate-400 m-0">
            {lang === 'en'
              ? 'Request on-demand technical analysis, order bespoke institutional studies, and access your research deliverables.'
              : 'Tạo bản phân tích kỹ thuật chuẩn hóa, đặt bài toán nghiên cứu vĩ mô riêng cho tổ chức và quản lý các kết quả bàn giao.'}
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
        initialSection="requests"
        onUnlockedLibrary={() => onNavigate('/portal/library')}
      />
    </div>
  );
};
