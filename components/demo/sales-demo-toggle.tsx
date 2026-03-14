/**
 * Sales Demo Mode Toggle
 * Enables realistic demo data for sales presentations
 *
 * Features:
 * - Toggle between real data and impressive demo data
 * - Persists in localStorage
 * - Floating button in bottom-right corner
 * - Clear visual indicator when demo mode is active
 */

'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function SalesDemoToggle() {
  const { enabled, toggle } = useSalesDemo();
  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      {/* Floating Toggle Button */}
      <div className="flex flex-col items-end gap-2">
        {enabled && (
          <div className="bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-semibold animate-pulse flex items-center gap-2">
            <Presentation className="h-4 w-4" />
            Sales Demo Mode Active
          </div>
        )}

        <Dialog open={showInfo} onOpenChange={setShowInfo}>
          <DialogTrigger asChild>
            <Button
              size="lg"
              variant={enabled ? 'default' : 'outline'}
              className={`rounded-full shadow-lg hover:shadow-xl transition-all ${
                enabled
                  ? 'bg-purple-600 hover:bg-purple-700 text-white border-2 border-purple-400'
                  : 'bg-white hover:bg-gray-50 border-2'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setShowInfo(true);
              }}
            >
              {enabled ? (
                <>
                  <Eye className="h-5 w-5 mr-2" />
                  Demo Mode
                </>
              ) : (
                <>
                  <EyeOff className="h-5 w-5 mr-2" />
                  Real Data
                </>
              )}
            </Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sales Demo Mode</DialogTitle>
              <DialogDescription className="space-y-3 pt-2">
                <p>
                  Toggle between <strong>real data</strong> and <strong>sales demo data</strong> for presentations.
                </p>

                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-foreground">When to use Sales Demo Mode:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>Sales calls with prospects</li>
                    <li>Internal presentations</li>
                    <li>Screenshots for marketing</li>
                    <li>Testing the sales narrative</li>
                  </ul>
                </div>

                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-foreground">Demo data shows:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>$12,847/mo cost savings (26x ROI)</li>
                    <li>847 hours/mo time saved (5 FTEs)</li>
                    <li>Elite tier performance (top 6%)</li>
                    <li>94/100 compliance score (SOC 2 ready)</li>
                  </ul>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-amber-900 mb-1">Note:</p>
                  <p className="text-amber-700">
                    All demo numbers are realistic and based on actual customer data.
                    Use them authentically in sales conversations.
                  </p>
                </div>

                <div className="pt-4 flex gap-2">
                  <Button
                    onClick={() => {
                      toggle();
                      setShowInfo(false);
                    }}
                    className={enabled ? 'flex-1' : 'flex-1 bg-purple-600 hover:bg-purple-700'}
                  >
                    {enabled ? (
                      <>
                        <EyeOff className="h-4 w-4 mr-2" />
                        Switch to Real Data
                      </>
                    ) : (
                      <>
                        <Eye className="h-4 w-4 mr-2" />
                        Enable Demo Mode
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => setShowInfo(false)}>
                    Cancel
                  </Button>
                </div>
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
