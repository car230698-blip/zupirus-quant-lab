import React from 'react';
import { AdminReportsPublisher } from '../../components/admin/AdminReportsPublisher';
import { useLanguage } from '../../i18n/LanguageContext';

export const AdminReportsPage: React.FC = () => {
  const { lang } = useLanguage();

  return (
    <div className="space-y-6">
      <div className="quant-heading">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-wider text-cyan-400">
            {lang === 'en' ? 'ADMIN CONSOLE · PUBLICATIONS' : 'TRẠM QUẢN TRỊ · XUẤT BẢN PDF'}
          </div>
          <h1>
            {lang === 'en' ? 'Quantitative PDF Reports Publisher' : 'Biên Tập & Xuất Bản Báo Cáo PDF'}
          </h1>
          <p className="text-sm text-slate-400 m-0">
            {lang === 'en'
              ? 'Create research drafts, attach out-of-sample WFO candidates, upload PDF files, and publish to the catalog.'
              : 'Soạn thảo bản nháp, gắn kết quả WFO, tải lên tệp PDF đầy đủ / đọc thử và phát hành lên danh mục công khai.'}
          </p>
        </div>
      </div>

      <AdminReportsPublisher />
    </div>
  );
};
