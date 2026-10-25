import { cn } from '@/lib/utils';
import { getSeverityColors, type SeverityLevel } from '@/lib/utils/severity-colors';

interface SeverityBadgeProps {
  severity: SeverityLevel;
  label: string;
  className?: string;
}

export function SeverityBadge({ severity, label, className }: SeverityBadgeProps) {
  const colors = getSeverityColors(severity);

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-label font-semibold border',
        colors.badge,
        className
      )}
    >
      {label}
    </span>
  );
}
