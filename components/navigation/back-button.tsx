'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BackButtonProps {
  href: string;
  label: string;
  className?: string;
  showKeyboardHint?: boolean;
}

export function BackButton({
  href,
  label,
  className,
  showKeyboardHint = false,
}: BackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    router.push(href);
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        variant="ghost"
        onClick={handleClick}
        className="group hover:bg-muted transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-2 group-hover:-translate-x-0.5 transition-transform" />
        {label}
      </Button>
      {showKeyboardHint && (
        <span className="text-meta text-ink-muted hidden md:inline">
          Press <kbd className="px-1.5 py-0.5 text-label font-semibold text-ink-body bg-gray-100 border border-gray-200 rounded">Esc</kbd> to go back
        </span>
      )}
    </div>
  );
}
