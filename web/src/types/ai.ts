/** Structured data emitted by the ZUPIRUS AI SDK streams. */

export interface PortfolioCardProps {
  accountsCount: number;
  accounts: Array<{
    id: string;
    login: string;
    server: string;
    mode?: string;
    balance: number;
    equity: number;
    positions: number;
  }>;
  totalBalance: number;
  totalEquity: number;
  onNavigate?: (tab: 'overview' | 'accounts' | 'orders') => void;
}

export interface RecentOrdersCardProps {
  orders: Array<{
    id: number | string;
    source: string;
    side: string;
    price: number;
    state: string;
    ticket?: string;
    deal?: string;
    created: number;
  }>;
  onNavigate?: (tab: 'overview' | 'accounts' | 'orders') => void;
}

export interface StrategyApprovalCardProps {
  jobId: string;
  report: {
    data?: string;
    method?: string;
    strategy?: string;
    oos_net_price_units?: number;
    max_drawdown_price_units?: number;
    trades?: number;
    folds?: Array<{
      train: number[];
      test: number[];
      period?: number;
      rule?: string;
      oos_net_price_units: number;
      trades: number;
    }>;
  };
  onApprove: (jobId: string) => Promise<void>;
  onReject: (jobId: string) => Promise<void>;
}
