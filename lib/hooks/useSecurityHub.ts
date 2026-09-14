import { useState, useEffect, useCallback } from 'react';
import { securityHubService, SecurityHubCapability, CisReadinessResult } from '../services/security-hub.service';

export function useSecurityHub() {
  const [capability, setCapability] = useState<SecurityHubCapability | null>(null);
  const [cis, setCis] = useState<CisReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [capabilityData, cisData] = await Promise.all([
        securityHubService.getCapability(),
        securityHubService.getCisReadiness(),
      ]);
      setCapability(capabilityData);
      setCis(cisData);
    } catch (err: any) {
      setError(err.message || 'Failed to load Security Hub status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const triggerSync = useCallback(async () => {
    try {
      setSyncing(true);
      setError(null);
      await securityHubService.triggerSync();
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to sync Security Hub');
    } finally {
      setSyncing(false);
    }
  }, [fetchAll]);

  return { capability, cis, loading, error, syncing, triggerSync, refetch: fetchAll };
}
