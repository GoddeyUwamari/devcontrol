'use client';

import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  showDivider?: boolean;
}

export function SectionHeader({
  title,
  description,
  action,
  className,
  showDivider = true,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4',
        showDivider && 'pt-6 border-t border-gray-100',
        className
      )}
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
