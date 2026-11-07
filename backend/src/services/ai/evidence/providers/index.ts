/**
 * The default evidence registry: every provider DevControl ships, in the
 * order every context lists them. To make a new data source AI-visible, add a
 * provider here (and its DATA_SOURCES entry in data-sources.ts); the
 * completeness test fails until both exist.
 */
import { EvidenceRegistry } from '../registry';
import { connectionScopeProvider, regionCoverageProvider } from './scope';
import { costFindingsProvider, monthOverMonthProvider, spendProvider, topEstimatedResourcesProvider } from './cost';
import { computeDetailProvider, resourceChangeHistoryProvider, resourceCountsProvider, resourceTypesProvider } from './inventory';
import {
  accountFindingsProvider,
  configChecksProvider,
  postureCountsProvider,
  riskScoreProvider,
  securityEvaluationProvider,
  securityHubProvider,
  topRiskProvider,
} from './security';
import { customFrameworkScansProvider, frameworkEvaluationsProvider } from './compliance';
import { cloudWatchAlarmsProvider, cpuTelemetryProvider, resourceHealthProvider, systemIntelligenceProvider } from './operations';
import { deploymentRecordsProvider, doraProvider } from './delivery';
import { alertHistoryProvider, anomaliesProvider } from './not-built';

export function createDefaultEvidenceRegistry(): EvidenceRegistry {
  return new EvidenceRegistry()
    .register(connectionScopeProvider)
    .register(regionCoverageProvider)
    .register(spendProvider)
    .register(monthOverMonthProvider)
    .register(costFindingsProvider)
    .register(topEstimatedResourcesProvider)
    .register(resourceCountsProvider)
    .register(resourceTypesProvider)
    .register(computeDetailProvider)
    .register(resourceChangeHistoryProvider)
    .register(accountFindingsProvider)
    .register(topRiskProvider)
    .register(securityEvaluationProvider)
    .register(configChecksProvider)
    .register(postureCountsProvider)
    .register(riskScoreProvider)
    .register(securityHubProvider)
    .register(frameworkEvaluationsProvider)
    .register(customFrameworkScansProvider)
    .register(cloudWatchAlarmsProvider)
    .register(resourceHealthProvider)
    .register(cpuTelemetryProvider)
    .register(systemIntelligenceProvider)
    .register(deploymentRecordsProvider)
    .register(doraProvider)
    .register(anomaliesProvider)
    .register(alertHistoryProvider);
}

let registry: EvidenceRegistry | null = null;

export function defaultEvidenceRegistry(): EvidenceRegistry {
  if (!registry) registry = createDefaultEvidenceRegistry();
  return registry;
}
