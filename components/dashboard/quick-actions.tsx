'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Search,
  FileText,
  Bell,
  Link as LinkIcon,
  Zap,
  ChevronDown,
} from 'lucide-react';

export interface QuickAction {
  id: string;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  shortcut?: string;
  variant?: 'primary' | 'secondary';
}

interface QuickActionsProps {
  actions?: QuickAction[];
  recentActions?: string[];
}

const defaultActions: QuickAction[] = [
  {
    id: 'add-service',
    label: 'Add Service',
    icon: Plus,
    onClick: () => console.log('Add service'),
    shortcut: '⌘N',
    variant: 'primary',
  },
  {
    id: 'scan-resources',
    label: 'Scan AWS Resources',
    icon: Search,
    onClick: () => console.log('Scan resources'),
    shortcut: '⌘S',
  },
  {
    id: 'generate-report',
    label: 'Generate Report',
    icon: FileText,
    onClick: () => console.log('Generate report'),
    shortcut: '⌘R',
  },
  {
    id: 'configure-alerts',
    label: 'Configure Alerts',
    icon: Bell,
    onClick: () => console.log('Configure alerts'),
  },
  {
    id: 'connect-account',
    label: 'Connect AWS Account',
    icon: LinkIcon,
    onClick: () => console.log('Connect account'),
  },
  {
    id: 'run-optimization',
    label: 'Run Cost Optimization',
    icon: Zap,
    onClick: () => console.log('Run optimization'),
  },
];

export function QuickActions({
  actions = defaultActions,
  recentActions = [],
}: QuickActionsProps) {
  const primaryAction = actions.find((a) => a.variant === 'primary');
  const secondaryActions = actions.filter((a) => a.variant !== 'primary');
  const recentActionItems = secondaryActions.filter((a) =>
    recentActions.includes(a.id)
  );

  return (
    <div className="flex items-center gap-2">
      {/* Primary Action Button */}
      {primaryAction && (
        <Button
          onClick={primaryAction.onClick}
          className="bg-[#7c3aed] hover:bg-[#4f46e5]"
        >
          <primaryAction.icon className="h-4 w-4 mr-2" />
          {primaryAction.label}
          {primaryAction.shortcut && (
            <kbd className="ml-2 px-1.5 py-0.5 text-xs font-mono bg-white/20 rounded">
              {primaryAction.shortcut}
            </kbd>
          )}
        </Button>
      )}

      {/* Quick Actions Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            Quick Actions
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {recentActionItems.length > 0 && (
            <>
              <DropdownMenuLabel>Recent Actions</DropdownMenuLabel>
              {recentActionItems.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  onClick={action.onClick}
                  className="cursor-pointer"
                >
                  <action.icon className="h-4 w-4 mr-2" />
                  <span className="flex-1">{action.label}</span>
                  {action.shortcut && (
                    <kbd className="ml-auto px-1.5 py-0.5 text-xs font-mono bg-gray-100 rounded">
                      {action.shortcut}
                    </kbd>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuLabel>All Actions</DropdownMenuLabel>
          {secondaryActions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              onClick={action.onClick}
              className="cursor-pointer"
            >
              <action.icon className="h-4 w-4 mr-2" />
              <span className="flex-1">{action.label}</span>
              {action.shortcut && (
                <kbd className="ml-auto px-1.5 py-0.5 text-xs font-mono bg-gray-100 rounded">
                  {action.shortcut}
                </kbd>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
