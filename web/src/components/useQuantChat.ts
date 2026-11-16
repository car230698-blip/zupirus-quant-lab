import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import type { PortfolioCardProps, RecentOrdersCardProps, StrategyApprovalCardProps } from '../types/ai.ts';

type QuantMessage = UIMessage<unknown, {
  portfolio: PortfolioCardProps;
  orders: RecentOrdersCardProps;
  approval: Pick<StrategyApprovalCardProps, 'jobId' | 'report'>;
}>;

const transports = {
  customer: new DefaultChatTransport<QuantMessage>({
    api: '/api/chat/assistant',
    credentials: 'include',
    headers: { 'X-Zupirus': '1' },
  }),
  admin: new DefaultChatTransport<QuantMessage>({
    api: '/api/chat/admin-agent',
    credentials: 'include',
    headers: { 'X-Zupirus': '1' },
  }),
};

export function useQuantChat(portal: keyof typeof transports) {
  return useChat<QuantMessage>({ transport: transports[portal] });
}
