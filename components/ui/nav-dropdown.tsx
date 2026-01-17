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
          'p-2',
          group.sections ? 'w-[480px]' : 'w-[320px]'
        )}
        align="start"
        sideOffset={8}
      >
        {group.sections ? (
          // Multi-section dropdown (like Platform, Solutions)
          <div className="grid grid-cols-2 gap-4">
            {group.sections.map((section, idx) => (
              <div key={idx} className="space-y-1">
                {section.label && (
                  <DropdownMenuLabel className="text-xs uppercase text-muted-foreground font-semibold px-2 pb-1">
                    {section.label}
                  </DropdownMenuLabel>
                )}
                <div className="space-y-0.5">
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
                            'flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors w-full',
                            'hover:bg-accent',
                            isActive && 'bg-accent/50'
                          )}
                        >
                          {Icon && (
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Icon className="w-4 h-4 text-primary" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-foreground flex items-center gap-2">
                              {item.label}
                              {item.badge && (
                                <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
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
          <div className="space-y-0.5">
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
                      'flex items-start gap-3 p-2.5 rounded-md cursor-pointer transition-colors w-full',
                      'hover:bg-accent',
                      isActive && 'bg-accent/50'
                    )}
                  >
                    {Icon && (
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-foreground">
                        {item.label}
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
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
