import { useState, useEffect, useCallback } from 'react';
import {
  complianceFrameworksService,
  ComplianceFramework,
  ComplianceFrameworkRule,
  ComplianceScan,
  ComplianceScanFinding,
  CreateFrameworkRequest,
  CreateRuleRequest,
} from '../services/compliance-frameworks.service';

export function useComplianceFrameworks() {
  const [frameworks, setFrameworks] = useState<ComplianceFramework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFrameworks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await complianceFrameworksService.getFrameworks();
      setFrameworks(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch frameworks');
      console.error('Error fetching frameworks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createFramework = async (data: CreateFrameworkRequest): Promise<ComplianceFramework> => {
    try {
      const newFramework = await complianceFrameworksService.createFramework(data);
      setFrameworks((prev) => [newFramework, ...prev]);
      return newFramework;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create framework');
    }
  };

  const updateFramework = async (id: string, data: Partial<CreateFrameworkRequest & { enabled: boolean }>): Promise<ComplianceFramework> => {
    try {
      const updated = await complianceFrameworksService.updateFramework(id, data);
      setFrameworks((prev) => prev.map((f) => (f.id === id ? updated : f)));
      return updated;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update framework');
    }
  };

  const deleteFramework = async (id: string): Promise<void> => {
    try {
      await complianceFrameworksService.deleteFramework(id);
      setFrameworks((prev) => prev.filter((f) => f.id !== id));
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete framework');
    }
  };

  const executeScan = async (frameworkId: string, resourceFilters?: Record<string, any>): Promise<void> => {
    try {
      await complianceFrameworksService.executeScan(frameworkId, resourceFilters);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to execute scan');
    }
  };

  useEffect(() => {
    fetchFrameworks();
  }, [fetchFrameworks]);

  return {
    frameworks,
    loading,
    error,
    fetchFrameworks,
    createFramework,
    updateFramework,
    deleteFramework,
    executeScan,
  };
}

export function useFrameworkDetails(frameworkId: string | null) {
  const [framework, setFramework] = useState<ComplianceFramework | null>(null);
  const [rules, setRules] = useState<ComplianceFrameworkRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFramework = useCallback(async () => {
    if (!frameworkId) {
      setFramework(null);
      setRules([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await complianceFrameworksService.getFramework(frameworkId);
      setFramework(data.framework);
      setRules(data.rules);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch framework details');
      console.error('Error fetching framework details:', err);
    } finally {
      setLoading(false);
    }
  }, [frameworkId]);

  const createRule = async (data: CreateRuleRequest): Promise<ComplianceFrameworkRule> => {
    if (!frameworkId) throw new Error('No framework selected');

    try {
      const newRule = await complianceFrameworksService.createRule(frameworkId, data);
      setRules((prev) => [...prev, newRule]);
      return newRule;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create rule');
    }
  };

  const updateRule = async (ruleId: string, data: Partial<CreateRuleRequest>): Promise<ComplianceFrameworkRule> => {
    try {
      const updated = await complianceFrameworksService.updateRule(ruleId, data);
      setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
      return updated;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update rule');
    }
  };

  const deleteRule = async (ruleId: string): Promise<void> => {
    try {
      await complianceFrameworksService.deleteRule(ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete rule');
    }
  };

  useEffect(() => {
    fetchFramework();
  }, [fetchFramework]);

  return {
    framework,
    rules,
    loading,
    error,
    fetchFramework,
    createRule,
    updateRule,
    deleteRule,
  };
}

export function useComplianceScans(autoRefresh = false) {
  const [scans, setScans] = useState<ComplianceScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await complianceFrameworksService.getScans(50);
      setScans(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch scans');
      console.error('Error fetching scans:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScans();

    if (autoRefresh) {
      const interval = setInterval(fetchScans, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [fetchScans, autoRefresh]);

  return {
    scans,
    loading,
    error,
    fetchScans,
  };
}

export function useScanResults(scanId: string | null) {
  const [scan, setScan] = useState<ComplianceScan | null>(null);
  const [findings, setFindings] = useState<ComplianceScanFinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    if (!scanId) {
      setScan(null);
      setFindings([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await complianceFrameworksService.getScanResults(scanId);
      setScan(data.scan);
      setFindings(data.findings);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch scan results');
      console.error('Error fetching scan results:', err);
    } finally {
      setLoading(false);
    }
  }, [scanId]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  return {
    scan,
    findings,
    loading,
    error,
    fetchResults,
  };
}
