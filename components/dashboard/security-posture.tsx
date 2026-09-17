/**
 * Security Posture & Risk Reduction
 * Shows $ value of prevented breaches
 *
 * "23 potential breach vectors prevented = $4.45M risk avoided"
 */

'use client';

import { Shield, Lock, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { SALES_DEMO_DATA } from '@/lib/demo/sales-demo-data';

interface SecurityPostureProps {
  demoMode?: boolean;
  realData?: {
    complianceScore: number;
    socTwoReady: boolean;
    s3BucketsEncrypted: number;
    securityGroupsTightened: number;
    iamPoliciesRestricted: number;
    nonCompliantBlocked: number;
    breachVectorsPrevented: number;
  };
}

export function SecurityPosture({ demoMode = false, realData }: SecurityPostureProps) {
  const data = demoMode ? SALES_DEMO_DATA : realData;

  if (!data) return null;

  const averageBreachCost = demoMode ? SALES_DEMO_DATA.averageBreachCost : 4450000;

  return (
    <Card className="border-2 border-emerald-200 hover:shadow-lg transition-all">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Shield className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <CardTitle className="text-xl">Security Posture</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {data.complianceScore}/100 compliance score
              </p>
            </div>
          </div>
          {data.socTwoReady && (
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 border-2 text-sm px-3 py-1">
              SOC 2 Readiness Tracked
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Compliance Score */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Compliance Score</span>
            <span className="text-xl font-bold text-emerald-700">{data.complianceScore}/100</span>
          </div>
          <Progress value={data.complianceScore} className="h-3" />
          <p className="text-xs text-muted-foreground mt-1">
            Supporting technical evidence for your SOC 2 program — not a compliance determination
          </p>
        </div>

        {/* Critical Issues Auto-Fixed */}
        <div className="pt-3 border-t">
          <p className="text-sm font-semibold text-red-700 mb-3 uppercase tracking-wide flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Critical Issues Auto-Fixed (Last 30 Days)
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium">{data.s3BucketsEncrypted} S3 buckets auto-encrypted</span>
              </div>
              <span className="text-xs font-semibold text-emerald-700">
                💰 Saved ${(averageBreachCost / 1000000).toFixed(2)}M breach cost
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium">{data.securityGroupsTightened} security groups tightened</span>
              </div>
              <span className="text-xs font-semibold text-emerald-700">🔒 Prevented data leak</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium">{data.iamPoliciesRestricted} IAM policies restricted</span>
              </div>
              <span className="text-xs font-semibold text-emerald-700">✅ SOC 2-relevant evidence</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium">{data.nonCompliantBlocked} non-compliant resources blocked</span>
              </div>
              <span className="text-xs font-semibold text-emerald-700">📋 Evidence logged</span>
            </div>
          </div>
        </div>

        {/* Breach Cost Avoided */}
        <div className="pt-4 border-t">
          <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg p-4 border border-red-200">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💡</span>
              <div className="text-sm">
                <p className="font-bold text-red-900 mb-1">
                  Average data breach costs ${(averageBreachCost / 1000000).toFixed(2)}M
                  <span className="text-xs font-normal text-red-600"> (IBM Security Report)</span>
                </p>
                <p className="text-red-700 font-semibold">
                  DevControl prevented{' '}
                  <span className="text-lg text-red-900">{data.breachVectorsPrevented}</span>{' '}
                  potential breach vectors
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
