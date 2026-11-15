/**
 * Type definitions for Vercel AI SDK 6 integration,
 * Generative UI components, and ToolLoopAgent approval protocol.
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
  result?: any;
}

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
      period: number;
      oos_net_price_units: number;
      trades: number;
    }>;
  };
  needsApproval: boolean;
  onApprove: (jobId: string) => Promise<void>;
  onReject: (jobId: string) => Promise<void>;
}

export interface ToolLoopAgentState {
  agentName: string;
  currentStep: number;
  isWaitingApproval: boolean;
  activeCandidateJobId: string | null;
  history: Message[];
}
