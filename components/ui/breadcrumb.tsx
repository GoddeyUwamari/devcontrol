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
  // Don't render if no items or only one item (current page)
  if (items.length <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('hidden sm:flex flex-nowrap items-center space-x-2 text-sm', className)}
    >
      <ol className="flex flex-nowrap items-center space-x-2">
        {/* Mobile: Show only last 2 items (parent + current) */}
        {items.length > 2 && (
          <li className="md:hidden inline-flex items-center shrink-0">
            {items[items.length - 2].href && (
              <>
                <Link
                  href={items[items.length - 2].href!}
                  className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                >
                  {items[items.length - 2].label}
                </Link>
                <ChevronRight className="mx-2 h-4 w-4 text-gray-400 dark:text-gray-500" />
              </>
            )}
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {items[items.length - 1].label}
            </span>
          </li>
        )}

        {/* Desktop: Show all items */}
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li
              key={item.href || `${item.label}-${index}`}
              className={cn(
                'items-center',
                items.length >= 2 ? 'hidden md:inline-flex' : 'inline-flex'
              )}
            >
              {index > 0 && (
                <ChevronRight className="mx-2 h-4 w-4 text-gray-400 dark:text-gray-500" />
              )}

              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    isLast
                      ? 'font-medium text-gray-900 dark:text-gray-100'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
