'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

interface BillingToggleProps {
  value: 'monthly' | 'annual';
  onChange: (value: 'monthly' | 'annual') => void;
}

export function BillingToggle({ value, onChange }: BillingToggleProps) {
  return (
    <div className="flex justify-center mb-12">
      <Tabs value={value} onValueChange={(v) => onChange(v as 'monthly' | 'annual')}>
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="monthly" className="text-sm font-medium">
            Monthly
          </TabsTrigger>
          <TabsTrigger value="annual" className="text-sm font-medium gap-2">
            Annual
            <Badge
              variant="secondary"
              className="ml-2 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 border-0 font-semibold"
            >
              Save 20%
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
