import { DriveStep } from 'driver.js';

export const dependenciesTour: DriveStep[] = [
  {
    element: '#dependencies-header',
    popover: {
      title: 'Welcome to Service Dependencies! 👋',
      description: "Let's take a quick tour of how to manage and visualize your service dependencies. This will only take 60 seconds.",
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '#stats-cards',
    popover: {
      title: 'Dependency Overview 📊',
      description: 'Get a quick snapshot of your dependency health: total dependencies, critical paths, and circular dependencies that need attention.',
      side: 'bottom',
    },
  },
  {
    element: '#search-bar',
    popover: {
      title: 'Quick Search 🔍',
      description: 'Find any dependency instantly. Try pressing <kbd>⌘K</kbd> (Mac) or <kbd>Ctrl+K</kbd> (Windows) to focus the search from anywhere.',
      side: 'bottom',
    },
  },
  {
    element: '#filter-controls',
    popover: {
      title: 'Advanced Filters 🎯',
      description: 'Filter dependencies by type (direct/transitive), status, or critical path. Combine multiple filters to find exactly what you need.',
      side: 'bottom',
    },
  },
  {
    element: '#view-tabs',
    popover: {
      title: 'Multiple Views 👁️',
      description: 'Switch between Graph view (visual), List view (detailed), and Impact Analysis (see what depends on what).',
      side: 'top',
    },
  },
  {
    element: '#export-menu',
    popover: {
      title: 'Export & Share 📤',
      description: 'Export your dependency data as CSV, PNG graph image, or comprehensive PDF report. Perfect for stakeholder meetings!',
      side: 'left',
      align: 'start',
    },
  },
  {
    element: '#keyboard-shortcuts-button',
    popover: {
      title: 'Keyboard Shortcuts ⌨️',
      description: 'Power users love shortcuts! Press <kbd>?</kbd> anytime to see all available keyboard shortcuts.',
      side: 'left',
    },
  },
  {
    popover: {
      title: "You're All Set! 🎉",
      description: 'Start by adding your first dependency or enable Demo Mode to explore with sample data. Questions? Check out our <a href="/docs/dependencies" class="text-blue-500 hover:underline">documentation</a>.',
    },
  },
];

export const tourConfig = {
  showProgress: true,
  showButtons: ['next', 'previous', 'close'] as ('next' | 'previous' | 'close')[],
  nextBtnText: 'Next →',
  prevBtnText: '← Back',
  doneBtnText: 'Got it! ✓',
  closeBtnText: 'Skip Tour',
  progressText: 'Step {{current}} of {{total}}',
  allowClose: true,
  overlayClickNext: false,
  keyboardControl: true,
  animate: true,
};
