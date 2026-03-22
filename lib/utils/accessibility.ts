/**
 * Accessibility utility functions for WCAG 2.1 AA compliance
 */

/**
 * Announce message to screen readers via live region
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  // Skip during SSR
  if (typeof window === 'undefined') return;

  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement is processed
  setTimeout(() => {
    if (document.body.contains(announcement)) {
      document.body.removeChild(announcement);
    }
  }, 1000);
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Check if user prefers high contrast
 */
export function prefersHighContrast(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-contrast: high)').matches;
}

/**
 * Trap focus within a container (useful for modals/dialogs)
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableSelectors = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const focusableElements = container.querySelectorAll<HTMLElement>(focusableSelectors);
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  function handleTabKey(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        lastElement?.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === lastElement) {
        firstElement?.focus();
        e.preventDefault();
      }
    }
  }

  container.addEventListener('keydown', handleTabKey);

  // Focus first element
  firstElement?.focus();

  // Return cleanup function
  return () => container.removeEventListener('keydown', handleTabKey);
}

/**
 * Generate accessible description for stat cards
 */
export function getAccessibleStatDescription(element: {
  label: string;
  value: number | string;
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    value?: string;
    changePercent?: number;
  };
}): string {
  let description = `${element.label}: ${element.value}`;

  if (element.trend) {
    const trendValue = element.trend.value ?? (element.trend.changePercent != null ? `${Math.abs(element.trend.changePercent).toFixed(1)}%` : '');
    const trendText =
      element.trend.direction === 'up'
        ? `increased by ${trendValue}`
        : element.trend.direction === 'down'
        ? `decreased by ${trendValue}`
        : 'no change';
    description += `, ${trendText}`;
  }

  return description;
}

/**
 * Generate accessible description for dependency relationships
 */
export function getAccessibleDependencyDescription(dependency: {
  source: string;
  target: string;
  type: string;
  isCritical?: boolean;
}): string {
  const critical = dependency.isCritical ? 'critical ' : '';
  return `${dependency.source} has a ${critical}${dependency.type} dependency on ${dependency.target}`;
}

/**
 * Format count for screen readers (handles pluralization)
 */
export function formatCountForScreenReader(
  count: number,
  singular: string,
  plural?: string
): string {
  const pluralForm = plural || `${singular}s`;
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Get keyboard shortcut description for screen readers
 */
export function getKeyboardShortcutDescription(
  key: string,
  modifier?: 'Ctrl' | 'Alt' | 'Shift' | 'Cmd'
): string {
  const modifierText = modifier ? `${modifier} plus ` : '';
  return `${modifierText}${key}`;
}

/**
 * Create a unique ID for ARIA relationships
 */
let idCounter = 0;
export function generateAriaId(prefix: string = 'aria'): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Check if element is visible (not hidden by CSS)
 */
export function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
}

/**
 * Move focus to an element and announce its context
 */
export function focusAndAnnounce(
  element: HTMLElement,
  announcement?: string
): void {
  element.focus();
  if (announcement) {
    announceToScreenReader(announcement, 'polite');
  }
}
