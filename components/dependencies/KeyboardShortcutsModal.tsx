'use client';

import { useEffect } from 'react';
import { X, Command, Search, Filter, Download, HelpCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { getModifierSymbol, getModifierKey } from '@/lib/hooks/use-keyboard-shortcuts';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  icon?: React.ReactNode;
}

interface ShortcutCategory {
  title: string;
  shortcuts: ShortcutItem[];
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const modKey = getModifierKey();
  const modSymbol = getModifierSymbol();

  // Close modal with ESC key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault();
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const categories: ShortcutCategory[] = [
    {
      title: 'Search',
      shortcuts: [
        {
          keys: [modSymbol, 'K'],
          description: 'Focus search input',
          icon: <Search className="h-4 w-4" />,
        },
        {
          keys: [modSymbol, '/'],
          description: 'Focus search input (alternative)',
          icon: <Search className="h-4 w-4" />,
        },
        {
          keys: ['ESC'],
          description: 'Clear search and blur',
          icon: <X className="h-4 w-4" />,
        },
      ],
    },
    {
      title: 'Filters',
      shortcuts: [
        {
          keys: [modSymbol, 'Shift', 'F'],
          description: 'Open filter dropdown',
          icon: <Filter className="h-4 w-4" />,
        },
      ],
    },
    {
      title: 'Export',
      shortcuts: [
        {
          keys: [modSymbol, 'E'],
          description: 'Open export menu',
          icon: <Download className="h-4 w-4" />,
        },
      ],
    },
    {
      title: 'General',
      shortcuts: [
        {
          keys: ['?'],
          description: 'Show this help',
          icon: <HelpCircle className="h-4 w-4" />,
        },
      ],
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Command className="h-6 w-6" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Navigate faster with these keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-6">
          {categories.map((category) => (
            <div key={category.title}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {category.title}
              </h3>
              <div className="space-y-2">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {shortcut.icon && (
                        <div className="text-muted-foreground">
                          {shortcut.icon}
                        </div>
                      )}
                      <span className="text-sm">{shortcut.description}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <span key={keyIndex} className="flex items-center gap-1">
                          <kbd className="px-2 py-1.5 text-xs font-semibold text-foreground bg-muted border border-border rounded shadow-sm min-w-[2rem] text-center">
                            {key}
                          </kbd>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className="text-muted-foreground text-xs mx-0.5">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Press <kbd className="px-2 py-1 text-xs bg-muted border border-border rounded">ESC</kbd> to close</span>
            <button
              onClick={onClose}
              className="text-foreground hover:text-muted-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
