import { Badge } from '@/components/ui/badge';
import type { ServiceStatus } from '@/lib/types';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface HealthStatusBadgeProps {
  status: ServiceStatus;
  showIcon?: boolean;
}

export function HealthStatusBadge({ status, showIcon = true }: HealthStatusBadgeProps) {
  const variants: Record<ServiceStatus, string> = {
    healthy: 'bg-green-100 text-green-700 hover:bg-green-100',
    unhealthy: 'bg-red-100 text-red-700 hover:bg-red-100',
    degraded: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  };

  const labels: Record<ServiceStatus, string> = {
    healthy: 'UP',
    unhealthy: 'DOWN',
    degraded: 'DEGRADED',
  };

  const icons: Record<ServiceStatus, React.ReactNode> = {
    healthy: <CheckCircle2 className="h-3 w-3 mr-1" />,
    unhealthy: <XCircle className="h-3 w-3 mr-1" />,
    degraded: <AlertCircle className="h-3 w-3 mr-1" />,
  };

  return (
    <Badge className={variants[status]} variant="secondary">
      <span className="flex items-center">
        {showIcon && icons[status]}
        {labels[status]}
      </span>
    </Badge>
  );
}
