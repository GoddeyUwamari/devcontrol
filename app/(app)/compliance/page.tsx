import { redirect } from 'next/navigation';

/**
 * Retired: this route previously rendered a "SOC 2 & HIPAA Compliance" experience with
 * PASS/FAIL control badges and a downloadable "SOC 2 Type II Compliance Audit Report" PDF,
 * backed by ComplianceEngineService's heuristic scan (see backend/src/services/compliance-engine.service.ts)
 * — an artifact that could be mistaken for a real, independent SOC 2 audit, which DevControl
 * does not perform. Retired as part of the product-truthfulness remediation. All compliance
 * framework readiness now lives at /compliance/frameworks (Security Hub-backed CIS/PCI today).
 */
export default function CompliancePage() {
  redirect('/compliance/frameworks');
}
