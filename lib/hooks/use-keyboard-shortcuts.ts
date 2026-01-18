'use client';

import { useEffect, useCallback } from 'react';

export interface ShortcutHandlers {
  onSearch?: () => void;
  onClearSearch?: () => void;
  onShowHelp?: () => void;
  onOpenFilters?: () => void;
  onExport?: () => void;
}

/**
 * Detects if the user is on a Mac
 */
const isMac = () => {
  if (typeof window === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
};

/**
 * Checks if the user is typing in an input element
 */
const isTypingInInput = (event: KeyboardEvent): boolean => {
  const target = event.target as HTMLElement;
  const tagName = target.tagName.toLowerCase();

  // Ignore shortcuts when typing in inputs, textareas, or contenteditable elements
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
};

/**
 * Checks if a keyboard event matches the expected modifiers
 */
const matchesModifiers = (
  event: KeyboardEvent,
  options: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  }
): boolean => {
  const {
    ctrl = false,
    shift = false,
    alt = false,
    meta = false,
  } = options;

  return (
    event.ctrlKey === ctrl &&
    event.shiftKey === shift &&
    event.altKey === alt &&
    event.metaKey === meta
  );
};

/**
 * Custom hook for managing keyboard shortcuts
 * Handles platform differences (Mac CMD vs Windows/Linux CTRL)
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const {
    onSearch,
    onClearSearch,
    onShowHelp,
    onOpenFilters,
    onExport,
  } = handlers;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Always allow "?" for help, even in inputs
      if (event.key === '?' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // Only trigger if Shift is held (to type "?")
        if (event.shiftKey) {
          event.preventDefault();
          onShowHelp?.();
          return;
        }
      }

      // For "?", we need Shift to be pressed
      // Check for "?" key specifically
      if (event.key === '?' && onShowHelp) {
        event.preventDefault();
        onShowHelp();
        return;
      }

      // ESC to clear search - works anywhere
      if (event.key === 'Escape' && onClearSearch) {
        onClearSearch();
        return;
      }

      // Ignore other shortcuts when typing in inputs
      if (isTypingInInput(event)) {
        return;
      }

      const modKey = isMac() ? event.metaKey : event.ctrlKey;

      // CMD/CTRL + K: Focus search
      if (event.key === 'k' && modKey && !event.shiftKey && onSearch) {
        event.preventDefault();
        onSearch();
        return;
      }

      // CMD/CTRL + /: Focus search (alternative)
      if (event.key === '/' && modKey && !event.shiftKey && onSearch) {
        event.preventDefault();
        onSearch();
        return;
      }

      // CMD/CTRL + Shift + F: Open filters
      if (event.key === 'f' && modKey && event.shiftKey && onOpenFilters) {
        event.preventDefault();
        onOpenFilters();
        return;
      }

      // CMD/CTRL + E: Open export menu
      if (event.key === 'e' && modKey && !event.shiftKey && onExport) {
        event.preventDefault();
        onExport();
        return;
      }
    },
    [onSearch, onClearSearch, onShowHelp, onOpenFilters, onExport]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * Get the modifier key symbol for the current platform
 */
export function getModifierSymbol(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/**
 * Get the modifier key name for the current platform
 */
export function getModifierKey(): string {
  return isMac() ? 'Cmd' : 'Ctrl';
}
