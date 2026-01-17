'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavGroup } from '@/lib/navigation-config';

interface NavDropdownProps {
  group: NavGroup;
  className?: string;
}

export function NavDropdown({ group, className = '' }: NavDropdownProps) {
  const pathname = usePathname();

  // Check if any item in the group is currently active
  const isGroupActive = React.useMemo(() => {
    const allItems = [
      ...(group.items || []),
      ...(group.sections?.flatMap((s) => s.items) || []),
    ];
    return allItems.some(
      (item) =>
        pathname === item.href || pathname.startsWith(item.href + '/')
    );
  }, [group, pathname]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 px-3 py-2 text-base font-medium rounded-md transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            isGroupActive ? 'text-foreground' : 'text-muted-foreground',
            className
          )}
        >
          {group.label}
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className={cn(
          'px-4 py-6 shadow-xl border border-gray-200 dark:border-gray-800',
          group.sections ? 'w-[720px]' : 'w-[400px]'
        )}
        align="start"
        sideOffset={8}
      >
        {group.sections ? (
          // Multi-section dropdown (like Platform, Solutions)
          <div className="grid grid-cols-2 gap-8">
            {group.sections.map((section, idx) => (
              <div key={idx} className="space-y-2">
                {section.label && (
                  <DropdownMenuLabel className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold tracking-wider px-2 pb-2">
                    {section.label}
                  </DropdownMenuLabel>
                )}
                <div className="space-y-2">
                  {section.items.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      pathname.startsWith(item.href + '/');
                    const Icon = item.icon;

                    return (
                      <DropdownMenuItem key={item.href} asChild className="p-0">
                        <Link
                          href={item.href}
                          className={cn(
                            'flex items-start gap-4 p-4 rounded-lg cursor-pointer transition-all duration-200 w-full',
                            'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                            isActive && 'bg-blue-50 dark:bg-blue-900/20'
                          )}
                        >
                          {Icon && (
                            <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <Icon className="w-5 h-5 text-primary" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-base text-foreground flex items-center gap-2">
                              {item.label}
                              {item.badge && (
                                <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            {item.description && (
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed line-clamp-2">
                                {item.description}
                              </p>
                            )}
                          </div>
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Simple list dropdown (like Resources)
          <div className="space-y-2">
            {group.items?.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(item.href + '/');
              const Icon = item.icon;

              return (
                <DropdownMenuItem key={item.href} asChild className="p-0">
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-start gap-4 p-4 rounded-lg cursor-pointer transition-all duration-200 w-full',
                      'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                      isActive && 'bg-blue-50 dark:bg-blue-900/20'
                    )}
                  >
                    {Icon && (
                      <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-base text-foreground">
                        {item.label}
                      </div>
                      {item.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
