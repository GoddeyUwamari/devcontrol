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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { userNavSections } from '@/lib/navigation-config';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';

interface UserDropdownProps {
  user: {
    name: string;
    email: string;
    initials: string;
  };
  onLogout: () => void;
}

export function UserDropdown({ user, onLogout }: UserDropdownProps) {
  const pathname = usePathname();
  const isDemoMode = useDemoMode();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 p-1 rounded-full hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Avatar className="w-9 h-9">
            <AvatarFallback className="bg-muted text-muted-foreground text-base font-semibold border border-border">
              {user.initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-64 p-2" align="end" sideOffset={8}>
        {/* User Info Header */}
        <div className="px-3 py-2.5 mb-1">
          <div className="font-medium text-foreground">{user.name}</div>
          <div className="text-sm text-muted-foreground truncate">
            {user.email}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Sections with items */}
        {userNavSections.map((section, sectionIdx) => (
          <div key={sectionIdx}>
            {sectionIdx > 0 && <DropdownMenuSeparator className="my-1" />}
            <div className="py-1">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + '/');
                const Icon = item.icon;

                return (
                  <DropdownMenuItem key={item.href} asChild className="p-0">
                    <Link
                      href={item.href}
                      {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer w-full',
                        'hover:bg-accent',
                        isActive && 'bg-accent/50'
                      )}
                    >
                      {Icon && (
                        <Icon className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="flex-1 text-sm">{item.label}</span>
                      {item.badge && (
                        <span className="px-2 py-0.5 text-xs bg-destructive/10 text-destructive rounded-full font-medium">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </div>
          </div>
        ))}

        <DropdownMenuSeparator className="my-1" />

        {/* Demo Mode toggle */}
        <div style={{ borderTop: '1px solid #F1F5F9', margin: '4px 0' }} />
        <button
          onClick={() => {
            const isDemo = localStorage.getItem('devcontrol_demo_mode') === 'true'
            const next = !isDemo
            localStorage.setItem('devcontrol_demo_mode', String(next))
            window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled: next } }))
            window.location.reload()
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            fontSize: '0.82rem',
            color: '#7C3AED',
            fontWeight: 500,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            borderRadius: '6px',
          }}
        >
          <span style={{
            width: '16px',
            height: '16px',
            borderRadius: '4px',
            background: '#7C3AED',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            color: '#fff',
            flexShrink: 0,
          }}>D</span>
          {isDemoMode ? 'Exit Demo Mode' : 'Enter Demo Mode'}
        </button>

        <DropdownMenuSeparator className="my-1" />

        {/* Logout */}
        <DropdownMenuItem
          onClick={onLogout}
          className="px-3 py-2 text-destructive hover:text-destructive focus:text-destructive cursor-pointer"
        >
          <LogOut className="w-4 h-4 mr-3" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
