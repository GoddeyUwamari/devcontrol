/**
 * Breadcrumb Component
 * Shows hierarchical navigation path with clickable links
 */

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  current?: boolean;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  if (items.length <= 1) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex items-center text-sm', className)}
    >
      <div className="flex items-center flex-nowrap w-full">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const hiddenOnMobile = index < items.length - 2;
          const separatorHiddenOnMobile = index > 0 && index - 1 < items.length - 2;

          return (
            <div
              key={item.href || `${item.label}-${index}`}
              className={cn(
                'flex items-center flex-nowrap shrink-0',
                hiddenOnMobile ? 'hidden sm:flex' : 'flex'
              )}
            >
              {index > 0 && (
                <ChevronRight
                  className={cn(
                    'mx-1 h-4 w-4 text-gray-400 shrink-0',
                    separatorHiddenOnMobile ? 'hidden sm:block' : 'block'
                  )}
                />
              )}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="breadcrumb-link text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    'whitespace-nowrap',
                    isLast
                      ? 'font-medium text-gray-900 dark:text-gray-100'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}