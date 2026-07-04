export interface RiskScoreFactors {
  encryption: number;
  publicAccess: number;
  backup: number;
  compliance: number;
  resourceManagement: number;
}

export interface RiskScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  color: string;
  factors: RiskScoreFactors;
  frameworksAtRisk: string[];
  // False until compliance scanning + orphaned-resource detection have actually run —
  // until then, compliance/resourceManagement inputs are stubs and the score/grade
  // must not be presented as a confident, final assessment.
  isPreliminary: boolean;
}

export function calculateRiskScore(factors: {
  publicResources: number;
  totalResources: number;
  unencryptedResources: number;
  complianceIssues: { critical: number; high: number; medium: number; low: number };
  missingBackups: number;
  orphanedResources: number;
  scanCompleted: boolean;
}): RiskScore {
  const publicAccessScore = factors.totalResources > 0
    ? (1 - factors.publicResources / factors.totalResources) * 100
    : 100;

  const encryptionScore = factors.totalResources > 0
    ? (1 - factors.unencryptedResources / factors.totalResources) * 100
    : 100;

  const complianceScore = Math.max(0, 100 - (
    factors.complianceIssues.critical * 10 +
    factors.complianceIssues.high * 5 +
    factors.complianceIssues.medium * 2 +
    factors.complianceIssues.low * 1
  ));

  const backupScore = factors.totalResources > 0
    ? (1 - factors.missingBackups / factors.totalResources) * 100
    : 100;

  const resourceMgmtScore = factors.totalResources > 0
    ? (1 - factors.orphanedResources / factors.totalResources) * 100
    : 100;

  const totalScore =
    publicAccessScore * 0.30 +
    encryptionScore * 0.25 +
    complianceScore * 0.25 +
    backupScore * 0.15 +
    resourceMgmtScore * 0.05;

  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  let color: string;
  if (totalScore >= 90) { grade = 'A'; color = 'text-green-600'; }
  else if (totalScore >= 80) { grade = 'B'; color = 'text-green-500'; }
  else if (totalScore >= 70) { grade = 'C'; color = 'text-yellow-600'; }
  else if (totalScore >= 60) { grade = 'D'; color = 'text-orange-600'; }
  else { grade = 'F'; color = 'text-red-600'; }

  return {
    score: Math.round(totalScore),
    grade,
    color,
    factors: {
      encryption: Math.round(encryptionScore),
      publicAccess: Math.round(publicAccessScore),
      backup: Math.round(backupScore),
      compliance: Math.round(complianceScore),
      resourceManagement: Math.round(resourceMgmtScore),
    },
    // Severity counts alone don't identify which frameworks are impacted; leave honest until compliance_issues carries framework tags.
    frameworksAtRisk: [],
    isPreliminary: !factors.scanCompleted,
  };
}
