/**
 * UpgradeModal Component
 * Modal dialog shown when users hit resource limits. Plan names and the
 * lines under "What you get" come from the plan catalog (lib/plan/plan-catalog.ts).
 */

'use client';

import { Sparkles, TrendingUp, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';
import { planName, type Tier } from '@/lib/plan/plan-names';
import { UPGRADE_MODAL, lines } from '@/lib/plan/plan-catalog';
import { FeatureText } from '@/components/billing/feature-line';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  currentTier: string;
  requiredTier: string;
  currentLimit?: number;
  nextLimit?: number | string;
  resourceType?: string;
}

function isTier(value: string): value is Tier {
  return value === 'free' || value === 'starter' || value === 'pro' || value === 'enterprise';
}

export function UpgradeModal({
  open,
  onOpenChange,
  title = "You've reached your limit",
  description,
  currentTier,
  requiredTier,
  currentLimit,
  nextLimit,
  resourceType = 'resources',
}: UpgradeModalProps) {
  const router = useRouter();

  const handleUpgrade = () => {
    onOpenChange(false);
    router.push('/settings/billing/upgrade');
  };

  const tierDisplay = planName(requiredTier);
  const currentTierDisplay = planName(currentTier);
  const benefits = isTier(requiredTier) ? lines(UPGRADE_MODAL[requiredTier]) : [];

  // Format limits for display
  const formatLimit = (limit: number | string | undefined) => {
    if (limit === undefined) return null;
    if (limit === -1 || limit === 'unlimited') return 'Unlimited';
    return limit.toLocaleString();
  };

  const displayCurrentLimit = formatLimit(currentLimit);
  const displayNextLimit = formatLimit(nextLimit);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">{title}</DialogTitle>
          <DialogDescription className="text-center">
            {description || `Upgrade to ${tierDisplay} to add more ${resourceType}`}
          </DialogDescription>
        </DialogHeader>

        {/* Current vs Next Tier Comparison */}
        {displayCurrentLimit && displayNextLimit && (
          <div className="py-4 space-y-3">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <X className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{currentTierDisplay}</div>
                  <div className="text-xs text-muted-foreground">Current limit</div>
                </div>
              </div>
              <div className="text-lg font-bold text-muted-foreground">
                {displayCurrentLimit}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-primary/10 border-2 border-primary/20 rounded-lg">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-primary">{tierDisplay}</div>
                  <div className="text-xs text-muted-foreground">New limit</div>
                </div>
              </div>
              <div className="text-lg font-bold text-primary">
                {displayNextLimit}
              </div>
            </div>
          </div>
        )}

        {/* Benefits */}
        {benefits.length > 0 && (
          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-3">What you get on {tierDisplay}:</p>
            <ul className="space-y-2">
              {benefits.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  <FeatureText feature={f} aiChip={false} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Not Now
          </Button>
          <Button onClick={handleUpgrade} className="w-full sm:w-auto">
            <TrendingUp className="mr-2 h-4 w-4" />
            Upgrade to {tierDisplay}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
