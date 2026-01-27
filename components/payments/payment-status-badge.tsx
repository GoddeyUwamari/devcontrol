import { Badge } from '@/components/ui/badge';
import type { PaymentStatus } from '@/lib/types';

interface PaymentStatusBadgeProps {
  status: PaymentStatus;
}

export function PaymentStatusBadge({ status }: PaymentStatusBadgeProps) {
  const variants: Record<PaymentStatus, string> = {
    succeeded: 'bg-green-100 text-green-700 hover:bg-green-100',
    pending: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
    failed: 'bg-red-100 text-red-700 hover:bg-red-100',
    cancelled: 'bg-gray-100 text-gray-700 hover:bg-gray-100',
    refunded: 'bg-orange-100 text-orange-700 hover:bg-orange-100',
  };

  const labels: Record<PaymentStatus, string> = {
    succeeded: 'Succeeded',
    pending: 'Pending',
    failed: 'Failed',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  };

  return (
    <Badge className={variants[status]} variant="secondary">
      {labels[status]}
    </Badge>
  );
}
