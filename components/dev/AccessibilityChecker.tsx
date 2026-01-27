'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X, CheckCircle, XCircle } from 'lucide-react';

interface AccessibilityIssue {
  type: 'error' | 'warning';
  message: string;
  element?: string;
}

/**
 * Development-only component that checks for common accessibility issues
 * Only renders in development mode
 */
export function AccessibilityChecker() {
  const [issues, setIssues] = useState<AccessibilityIssue[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    // Only run in development
    if (process.env.NODE_ENV !== 'development') return;

    // Delay check to allow page to fully render
    const timeoutId = setTimeout(() => {
      runAccessibilityChecks();
      setHasRun(true);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, []);

  const runAccessibilityChecks = () => {
    const foundIssues: AccessibilityIssue[] = [];

    // Check for images without alt text
    document.querySelectorAll('img:not([alt])').forEach((img) => {
      const src = img.getAttribute('src') || 'unknown';
      foundIssues.push({
        type: 'error',
        message: 'Image missing alt text',
        element: `<img src="${src.substring(0, 50)}...">`,
      });
    });

    // Check for empty alt text on non-decorative images
    document.querySelectorAll('img[alt=""]').forEach((img) => {
      const src = img.getAttribute('src') || 'unknown';
      // Skip if it has aria-hidden="true" (decorative)
      if (img.getAttribute('aria-hidden') !== 'true') {
        foundIssues.push({
          type: 'warning',
          message: 'Image has empty alt text (verify if decorative)',
          element: `<img src="${src.substring(0, 50)}...">`,
        });
      }
    });

    // Check for buttons without accessible names
    document.querySelectorAll('button').forEach((btn) => {
      const hasText = btn.textContent?.trim();
      const hasAriaLabel = btn.getAttribute('aria-label');
      const hasAriaLabelledBy = btn.getAttribute('aria-labelledby');
      const hasTitle = btn.getAttribute('title');

      if (!hasText && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
        foundIssues.push({
          type: 'error',
          message: 'Button missing accessible name',
          element: btn.outerHTML.substring(0, 100),
        });
      }
    });

    // Check for links without accessible names
    document.querySelectorAll('a[href]').forEach((link) => {
      const hasText = link.textContent?.trim();
      const hasAriaLabel = link.getAttribute('aria-label');
      const hasAriaLabelledBy = link.getAttribute('aria-labelledby');

      if (!hasText && !hasAriaLabel && !hasAriaLabelledBy) {
        foundIssues.push({
          type: 'error',
          message: 'Link missing accessible name',
          element: link.outerHTML.substring(0, 100),
        });
      }
    });

    // Check for form inputs without labels
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').forEach((input) => {
      const id = input.getAttribute('id');
      const hasAriaLabel = input.getAttribute('aria-label');
      const hasAriaLabelledBy = input.getAttribute('aria-labelledby');
      const hasAssociatedLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasPlaceholder = input.getAttribute('placeholder');

      if (!hasAriaLabel && !hasAriaLabelledBy && !hasAssociatedLabel) {
        foundIssues.push({
          type: hasPlaceholder ? 'warning' : 'error',
          message: hasPlaceholder
            ? 'Input relies only on placeholder for label'
            : 'Input missing label',
          element: `<input name="${input.getAttribute('name') || 'unnamed'}" type="${input.getAttribute('type') || 'text'}">`,
        });
      }
    });

    // Check for missing heading structure
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let lastLevel = 0;
    headings.forEach((heading) => {
      const level = parseInt(heading.tagName.charAt(1));
      if (level - lastLevel > 1 && lastLevel !== 0) {
        foundIssues.push({
          type: 'warning',
          message: `Heading level skipped (h${lastLevel} to h${level})`,
          element: `<${heading.tagName.toLowerCase()}>${heading.textContent?.substring(0, 30)}...</${heading.tagName.toLowerCase()}>`,
        });
      }
      lastLevel = level;
    });

    // Check for missing main landmark
    if (!document.querySelector('main, [role="main"]')) {
      foundIssues.push({
        type: 'error',
        message: 'Page missing <main> landmark',
      });
    }

    // Check for low contrast text (simplified check)
    // Note: This is a basic check - use proper tools for comprehensive testing

    // Check for interactive elements with tabindex > 0
    document.querySelectorAll('[tabindex]').forEach((el) => {
      const tabindex = parseInt(el.getAttribute('tabindex') || '0');
      if (tabindex > 0) {
        foundIssues.push({
          type: 'warning',
          message: 'Element has positive tabindex (can disrupt navigation)',
          element: el.outerHTML.substring(0, 100),
        });
      }
    });

    // Check for auto-playing media
    document.querySelectorAll('video[autoplay], audio[autoplay]').forEach((media) => {
      if (!media.hasAttribute('muted')) {
        foundIssues.push({
          type: 'error',
          message: 'Auto-playing media without mute',
          element: media.tagName.toLowerCase(),
        });
      }
    });

    setIssues(foundIssues);

    if (foundIssues.length > 0) {
      console.group('Accessibility Issues Found');
      foundIssues.forEach((issue) => {
        const logFn = issue.type === 'error' ? console.error : console.warn;
        logFn(`[${issue.type.toUpperCase()}] ${issue.message}`, issue.element || '');
      });
      console.groupEnd();
    }
  };

  // Don't render in production
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  // Don't render if no checks have run yet
  if (!hasRun) {
    return null;
  }

  const errorCount = issues.filter((i) => i.type === 'error').length;
  const warningCount = issues.filter((i) => i.type === 'warning').length;

  // Don't show if no issues
  if (issues.length === 0) {
    return (
      <div className="fixed top-20 left-4 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg px-4 py-2 shadow-lg z-50 flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
        <span className="text-sm font-medium text-green-800 dark:text-green-200">
          No accessibility issues
        </span>
      </div>
    );
  }

  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="fixed top-20 left-4 bg-blue-100 dark:bg-blue-900/30 border border-blue-400 dark:border-blue-600 rounded-lg px-4 py-2 shadow-lg z-50 flex items-center gap-2 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
        aria-label={`Show ${issues.length} accessibility issues`}
      >
        <AlertTriangle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <span className="text-sm font-bold text-blue-900 dark:text-blue-100">
          A11y: {errorCount > 0 && <span className="text-red-600">{errorCount}E</span>}
          {errorCount > 0 && warningCount > 0 && ' / '}
          {warningCount > 0 && <span className="text-blue-600">{warningCount}W</span>}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed top-20 left-4 bg-white dark:bg-gray-900 border-2 border-blue-400 dark:border-blue-600 rounded-lg shadow-xl z-50 max-w-md max-h-96 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="font-bold text-blue-900 dark:text-blue-100">
            Accessibility Issues ({issues.length})
          </h3>
        </div>
        <button
          onClick={() => setIsMinimized(true)}
          className="p-1 hover:bg-blue-200 dark:hover:bg-blue-800 rounded transition-colors"
          aria-label="Minimize accessibility checker"
        >
          <X className="w-4 h-4 text-blue-700 dark:text-blue-300" />
        </button>
      </div>

      {/* Summary */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex gap-4 text-sm">
        {errorCount > 0 && (
          <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <XCircle className="w-4 h-4" />
            <span>{errorCount} errors</span>
          </div>
        )}
        {warningCount > 0 && (
          <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
            <AlertTriangle className="w-4 h-4" />
            <span>{warningCount} warnings</span>
          </div>
        )}
      </div>

      {/* Issues List */}
      <ul className="overflow-y-auto p-2 space-y-2 flex-1">
        {issues.map((issue, i) => (
          <li
            key={i}
            className={`text-sm p-2 rounded ${
              issue.type === 'error'
                ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
            }`}
          >
            <div
              className={`font-medium ${
                issue.type === 'error'
                  ? 'text-red-800 dark:text-red-200'
                  : 'text-blue-800 dark:text-blue-200'
              }`}
            >
              {issue.message}
            </div>
            {issue.element && (
              <code className="text-xs text-gray-600 dark:text-gray-400 block mt-1 truncate">
                {issue.element}
              </code>
            )}
          </li>
        ))}
      </ul>

      {/* Footer */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        Dev-only • Use axe-core for comprehensive testing
      </div>
    </div>
  );
}
