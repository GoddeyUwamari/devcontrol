import { Badge } from '@/components/ui/badge';

interface RefundStatusBadgeProps {
  status: string;
}

export function RefundStatusBadge({ status }: RefundStatusBadgeProps) {
  const variants: Record<string, string> = {
    pending: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
    processing: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
    succeeded: 'bg-green-100 text-green-700 hover:bg-green-100',
    failed: 'bg-red-100 text-red-700 hover:bg-red-100',
    cancelled: 'bg-gray-100 text-gray-700 hover:bg-gray-100',
  };

  const labels: Record<string, string> = {
    pending: 'Pending',
    processing: 'Processing',
    succeeded: 'Succeeded',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };

  return (
    <Badge className={variants[status] || variants.pending} variant="secondary">
      {labels[status] || status}
    </Badge>
  );
}
