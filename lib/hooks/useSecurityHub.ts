import { useState, useEffect, useCallback } from 'react';
import { securityHubService, SecurityHubCapability, CisReadinessResult, PciReadinessResult, NistReadinessResult } from '../services/security-hub.service';

export function useSecurityHub() {
  const [capability, setCapability] = useState<SecurityHubCapability | null>(null);
  const [cis, setCis] = useState<CisReadinessResult | null>(null);
  const [pci, setPci] = useState<PciReadinessResult | null>(null);
  const [nist, setNist] = useState<NistReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [capabilityData, cisData, pciData, nistData] = await Promise.all([
        securityHubService.getCapability(),
        securityHubService.getCisReadiness(),
        securityHubService.getPciReadiness(),
        securityHubService.getNistReadiness(),
      ]);
      setCapability(capabilityData);
      setCis(cisData);
      setPci(pciData);
      setNist(nistData);
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

  return { capability, cis, pci, nist, loading, error, syncing, triggerSync, refetch: fetchAll };
}
