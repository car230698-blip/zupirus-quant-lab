import React from 'react';
import { QuantReportCatalogAndLibrary } from './QuantReportCatalogAndLibrary';
import { UserReferralAndInvoicesSection } from './UserReferralAndInvoicesSection';
import { useLanguage } from '../i18n/LanguageContext';

export interface UserAccountsTabProps {
  accounts?: any[];
  refetchAccounts?: () => void;
}

export const UserAccountsTab: React.FC<UserAccountsTabProps> = ({
  accounts = [],
}) => {
  const { lang } = useLanguage();

  return (
    <div className="space-y-8">
      {/* Primary View: My Quantitative PDF Report Library & Catalog */}
      <QuantReportCatalogAndLibrary mode="portal" initialSection="library" />

      {/* Read-Only Historical Reconciliation Notice (Only shown if legacy records exist) */}
      {accounts.length > 0 && (
        <div className="rounded-2xl border border-slate-800/80 bg-[#0B1220]/80 p-5 space-y-2">
          <div className="font-mono text-xs font-bold uppercase text-amber-300">
            {lang === 'en'
              ? 'HISTORICAL RECONCILIATION ARCHIVE (READ-ONLY)'
              : 'LƯU TRỮ ĐỐI SOÁT LỊCH SỬ (CHẾ ĐỘ CHỈ ĐỌC)'}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            {lang === 'en'
              ? `ZUPIRUS Quant Lab operates exclusively as an XAU/USD quantitative research & PDF report platform. Automated customer trade execution is disabled. Your ${accounts.length} historical record(s) are preserved in read-only mode for reconciliation.`
              : `ZUPIRUS Quant Lab vận hành hoàn toàn dưới mô hình Phòng nghiên cứu định lượng XAU/USD & Ấn phẩm báo cáo PDF trên website. Tính năng tự động giao dịch qua tài khoản môi giới đã được tắt an toàn. ${accounts.length} bản ghi lịch sử của bạn được giữ nguyên ở chế độ chỉ đọc để đối soát.`}
          </p>
        </div>
      )}

      {/* Invoices & Referral History */}
      <UserReferralAndInvoicesSection />
    </div>
  );
};
