export interface RiskFactor {
  name: string;
  weight: number;
  score: number;
}

export interface RiskScore {
  total: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: RiskFactor[];
}

export function calculateRiskScore(factors: {
  publicResources: number;
  totalResources: number;
  unencryptedResources: number;
  complianceIssues: { critical: number; high: number; medium: number; low: number };
  missingBackups: number;
  orphanedResources: number;
}): RiskScore {
  const publicAccessScore = factors.totalResources > 0
    ? (1 - factors.publicResources / factors.totalResources) * 100
    : 100;

  const encryptionScore = factors.totalResources > 0
    ? (1 - factors.unencryptedResources / factors.totalResources) * 100
    : 100;

  const complianceScore = 100 - (
    factors.complianceIssues.critical * 10 +
    factors.complianceIssues.high * 5 +
    factors.complianceIssues.medium * 2 +
    factors.complianceIssues.low * 1
  );

  const backupScore = factors.totalResources > 0
    ? (1 - factors.missingBackups / factors.totalResources) * 100
    : 100;

  const resourceMgmtScore = factors.totalResources > 0
    ? (1 - factors.orphanedResources / factors.totalResources) * 100
    : 100;

  const riskFactors: RiskFactor[] = [
    { name: 'Public Access', weight: 0.30, score: publicAccessScore },
    { name: 'Encryption', weight: 0.25, score: encryptionScore },
    { name: 'Compliance', weight: 0.25, score: Math.max(0, complianceScore) },
    { name: 'Backup', weight: 0.15, score: backupScore },
    { name: 'Resource Management', weight: 0.05, score: resourceMgmtScore },
  ];

  const totalScore = riskFactors.reduce((sum, factor) => {
    return sum + (factor.score * factor.weight);
  }, 0);

  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (totalScore >= 90) grade = 'A';
  else if (totalScore >= 80) grade = 'B';
  else if (totalScore >= 70) grade = 'C';
  else if (totalScore >= 60) grade = 'D';
  else grade = 'F';

  return {
    total: Math.round(totalScore),
    grade,
    factors: riskFactors,
  };
}
