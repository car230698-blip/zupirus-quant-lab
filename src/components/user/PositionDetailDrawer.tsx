import React from 'react';
import type { ReconciliationRecord, SimulatedPosition } from '../../quant/types.ts';
import { PositionDetailCard } from '../shared/PositionDetailCard.tsx';
import { SlideOverDrawer } from '../shared/UiPrimitives.tsx';

export interface PositionDetailDrawerProps {
  position: SimulatedPosition | null;
  reconciliation?: ReconciliationRecord;
  currentReferencePrice?: number;
  onClose: () => void;
}

export const PositionDetailDrawer: React.FC<PositionDetailDrawerProps> = ({
  position,
  reconciliation,
  currentReferencePrice,
  onClose,
}) => {
  if (!position) return null;

  return (
    <SlideOverDrawer
      isOpen={Boolean(position)}
      title={`Chi tiết Vị thế #${position.positionId}`}
      subtitle={`${position.direction} ${position.symbol} · ${position.filledVolumeLots.toFixed(2)} lot · ${position.strategyNameVi}`}
      onClose={onClose}
    >
      <PositionDetailCard
        position={position}
        reconciliation={reconciliation}
        currentReferencePrice={currentReferencePrice}
        onClose={onClose}
      />
    </SlideOverDrawer>
  );
};
