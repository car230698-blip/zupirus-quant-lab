import { useState, type FormEvent, type ReactNode } from 'react';

export type Portal = 'user' | 'admin';

const navigation = {
  user: [
    ['overview', 'Tổng quan', '◫'], ['accounts', 'Tài khoản MT5', '⌁'],
    ['orders', 'Lịch sử lệnh', '≡'], ['assistant', 'Trợ lý AI', '✦'],
  ],
  admin: [
    ['overview', 'Điều hành', '◫'], ['approvals', 'Phê duyệt', '◇'],
    ['activity', 'Hoạt động agent', '⌁'], ['tracing', 'Truy vết AI', '⊙'],
    ['news', 'Lịch rủi ro', '≡'],
  ],
};

const pageTitles: Record<Portal, Record<string, string>> = {
  user: { overview: 'Tổng quan danh mục', accounts: 'Tài khoản MT5', orders: 'Lịch sử lệnh', assistant: 'Trợ lý định lượng' },
  admin: { overview: 'Điều hành hệ thống', approvals: 'Phê duyệt chiến lược', activity: 'Hoạt động agent', tracing: 'Truy vết AI', news: 'Lịch rủi ro' },
};

function Brand() {
  return <div className="quant-brand"><span className="quant-mark" aria-hidden="true">Z</span><span>ZUPIRUS<small>QUANT LAB</small></span></div>;
}

export function PortalShell({ portal, page, onNavigate, email, switchPortal, logout, children }: {
  portal: Portal;
  page: string;
  onNavigate: (page: string) => void;
  email: string;
  switchPortal?: () => void;
  logout: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`quant-app quant-${portal}`}>
      <div className="quant-sidebar">
        <Brand />
        <div className="quant-workspace">{portal === 'admin' ? 'VẬN HÀNH' : 'KHÔNG GIAN GIAO DỊCH'}</div>
        <nav className="quant-nav" aria-label="Menu chính">
          {navigation[portal].map(([key, label, glyph]) => (
            <button className="quant-nav-button" key={key} onClick={() => onNavigate(key)} aria-current={page === key ? 'page' : undefined}>
              <span aria-hidden="true">{glyph}</span>{label}
            </button>
          ))}
        </nav>
        <div className="quant-sidebar-end"><span aria-hidden="true">↘</span> XAU/USD <small>·</small> MT5</div>
      </div>
      <div className="quant-stage">
        <div className="quant-topbar">
          <span className="quant-context">{portal === 'admin' ? 'Quản trị' : 'Danh mục'} <span aria-hidden="true">/</span> {navigation[portal].find(([key]) => key === page)?.[1]}</span>
          <div className="quant-session">
            {switchPortal && <button className="quant-quiet" onClick={switchPortal}>{portal === 'admin' ? 'Cổng người dùng' : 'Cổng quản trị'}</button>}
            <span className="quant-email" title={email}>{email}</span>
            <button className="quant-quiet" onClick={logout}>Đăng xuất</button>
          </div>
        </div>
        <main className="quant-content">
          <div className="quant-heading"><h1>{pageTitles[portal][page]}</h1></div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function PortalAuth({ portal, loading, error, onSubmit }: {
  portal: Portal;
  loading: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, register: boolean) => Promise<void>;
}) {
  const [register, setRegister] = useState(false);
  const title = portal === 'admin' ? 'Điều hành hệ thống' : 'Không gian giao dịch';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void onSubmit(String(data.get('email')), String(data.get('password')), register);
  }
  return (
    <div className={`quant-app quant-auth quant-${portal}`}>
      <div className="quant-auth-story">
        <Brand />
        <div className="quant-auth-art" aria-hidden="true">
          <div className="quant-orbit" /><div className="quant-orbit quant-orbit-inner" /><div className="quant-core"><span /><span /><span /></div>
        </div>
        <div className="quant-auth-title"><span>{portal === 'admin' ? 'VẬN HÀNH' : 'XAU/USD · MT5'}</span><h1>{title}</h1></div>
      </div>
      <div className="quant-auth-stage">
        <div className="quant-auth-box">
          <h2>{register ? 'Tạo tài khoản' : 'Đăng nhập'}</h2>
          <p>{portal === 'admin' ? 'Dành cho tài khoản có quyền quản trị.' : 'Truy cập danh mục và các tài khoản MT5 của bạn.'}</p>
          {error && <div className="quant-alert" role="alert">{error}</div>}
          <form onSubmit={submit}>
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" name="email" type="email" autoComplete="username" required />
            <label htmlFor="auth-password">Mật khẩu</label>
            <input id="auth-password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : undefined} required />
            <button className="quant-primary" disabled={loading}>{loading ? 'Đang xác thực…' : register ? 'Tạo tài khoản' : 'Đăng nhập'} <span aria-hidden="true">↗</span></button>
          </form>
          {portal === 'user' && <button className="quant-quiet" onClick={() => setRegister(!register)} disabled={loading}>{register ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}</button>}
        </div>
      </div>
    </div>
  );
}
