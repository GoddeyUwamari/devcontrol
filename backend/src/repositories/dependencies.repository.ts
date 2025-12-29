import { pool } from '../config/database';
import {
  ServiceDependency,
  CreateDependencyRequest,
  UpdateDependencyRequest,
  DependencyFilters,
  DependencyGraph,
  ImpactAnalysis,
  CircularDependency,
} from '../types';

export class DependenciesRepository {
  /**
   * Get all dependencies with optional filters
   * Joins with services table to get service names and status
   */
  async findAll(filters?: DependencyFilters): Promise<ServiceDependency[]> {
    let query = `
      SELECT
        sd.*,
        ss.name as source_service_name,
        ts.name as target_service_name,
        ss.status as source_service_status,
        ts.status as target_service_status
      FROM service_dependencies sd
      LEFT JOIN services ss ON sd.source_service_id = ss.id
      LEFT JOIN services ts ON sd.target_service_id = ts.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 0;

    if (filters?.source_service_id) {
      paramCount++;
      params.push(filters.source_service_id);
      query += ` AND sd.source_service_id = $${paramCount}`;
    }

    if (filters?.target_service_id) {
      paramCount++;
      params.push(filters.target_service_id);
      query += ` AND sd.target_service_id = $${paramCount}`;
    }

    if (filters?.dependency_type) {
      paramCount++;
      params.push(filters.dependency_type);
      query += ` AND sd.dependency_type = $${paramCount}`;
    }

    if (filters?.is_critical !== undefined) {
      paramCount++;
      params.push(filters.is_critical);
      query += ` AND sd.is_critical = $${paramCount}`;
    }

    query += ' ORDER BY sd.created_at DESC';

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get dependency by ID
   */
  async findById(id: string): Promise<ServiceDependency | null> {
    const query = `
      SELECT
        sd.*,
        ss.name as source_service_name,
        ts.name as target_service_name,
        ss.status as source_service_status,
        ts.status as target_service_status
      FROM service_dependencies sd
      LEFT JOIN services ss ON sd.source_service_id = ss.id
      LEFT JOIN services ts ON sd.target_service_id = ts.id
      WHERE sd.id = $1
    `;

    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Create new dependency
   * RLS automatically filters by organization via session variable
   */
  async create(
    dependency: CreateDependencyRequest,
    createdBy: string,
    organizationId: string
  ): Promise<ServiceDependency> {
    const query = `
      INSERT INTO service_dependencies (
        organization_id,
        source_service_id,
        target_service_id,
        dependency_type,
        description,
        is_critical,
        metadata,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await pool.query(query, [
      organizationId,
      dependency.source_service_id,
      dependency.target_service_id,
      dependency.dependency_type,
      dependency.description || null,
      dependency.is_critical || false,
      dependency.metadata || {},
      createdBy,
    ]);

    return result.rows[0];
  }

  /**
   * Update dependency
   */
  async update(
    id: string,
    updates: UpdateDependencyRequest
  ): Promise<ServiceDependency | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (updates.dependency_type !== undefined) {
      paramCount++;
      fields.push(`dependency_type = $${paramCount}`);
      values.push(updates.dependency_type);
    }

    if (updates.description !== undefined) {
      paramCount++;
      fields.push(`description = $${paramCount}`);
      values.push(updates.description);
    }

    if (updates.is_critical !== undefined) {
      paramCount++;
      fields.push(`is_critical = $${paramCount}`);
      values.push(updates.is_critical);
    }

    if (updates.metadata !== undefined) {
      paramCount++;
      fields.push(`metadata = $${paramCount}`);
      values.push(updates.metadata);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    paramCount++;
    values.push(id);

    const query = `
      UPDATE service_dependencies
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Delete dependency
   */
  async delete(id: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM service_dependencies WHERE id = $1',
      [id]
    );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  /**
   * Get dependency graph (formatted for React Flow)
   * Auto-layout will be done client-side
   */
  async getGraph(): Promise<DependencyGraph> {
    // Get all services and dependencies
    const servicesQuery = 'SELECT * FROM services ORDER BY name';
    const dependenciesQuery = `
      SELECT * FROM service_dependencies
    `;

    const [servicesResult, depsResult] = await Promise.all([
      pool.query(servicesQuery),
      pool.query(dependenciesQuery),
    ]);

    const services = servicesResult.rows;
    const dependencies = depsResult.rows;

    // Create nodes (services)
    // Simple grid layout initially - React Flow with Dagre will re-layout client-side
    const nodes: DependencyGraphNode[] = services.map((service, index) => ({
      id: service.id,
      type: 'default',
      position: {
        x: (index % 5) * 250,
        y: Math.floor(index / 5) * 150,
      },
      data: {
        label: service.name,
        status: service.status,
        owner: service.owner,
        template: service.template,
      },
    }));

    // Create edges (dependencies)
    const edges: DependencyGraphEdge[] = dependencies.map((dep) => ({
      id: dep.id,
      source: dep.source_service_id,
      target: dep.target_service_id,
      type: dep.is_critical ? 'step' : 'smoothstep',
      label: dep.dependency_type,
      animated: dep.is_critical,
      data: {
        dependency_type: dep.dependency_type,
        is_critical: dep.is_critical,
        description: dep.description,
      },
    }));

    return { nodes, edges };
  }

  /**
   * Get impact analysis for a service
   * Shows what depends on it (downstream) and what it depends on (upstream)
   */
  async getImpactAnalysis(serviceId: string): Promise<ImpactAnalysis> {
    // Get service info
    const serviceResult = await pool.query(
      'SELECT id, name FROM services WHERE id = $1',
      [serviceId]
    );

    if (serviceResult.rows.length === 0) {
      throw new Error('Service not found');
    }

    const service = serviceResult.rows[0];

    // Get upstream (what this service depends on)
    const upstreamQuery = `
      SELECT
        s.id,
        s.name,
        sd.dependency_type,
        sd.is_critical
      FROM service_dependencies sd
      JOIN services s ON sd.target_service_id = s.id
      WHERE sd.source_service_id = $1
    `;

    // Get downstream (what depends on this service)
    const downstreamQuery = `
      SELECT
        s.id,
        s.name,
        sd.dependency_type,
        sd.is_critical
      FROM service_dependencies sd
      JOIN services s ON sd.source_service_id = s.id
      WHERE sd.target_service_id = $1
    `;

    const [upstreamResult, downstreamResult] = await Promise.all([
      pool.query(upstreamQuery, [serviceId]),
      pool.query(downstreamQuery, [serviceId]),
    ]);

    const upstream = upstreamResult.rows;
    const downstream = downstreamResult.rows;

    // Check if on critical path (has critical dependencies)
    const criticalPath = upstream.some((d) => d.is_critical) ||
                        downstream.some((d) => d.is_critical);

    return {
      service_id: service.id,
      service_name: service.name,
      upstream_dependencies: upstream,
      downstream_dependencies: downstream,
      total_upstream: upstream.length,
      total_downstream: downstream.length,
      total_affected_if_fails: downstream.length,
      critical_path: criticalPath,
    };
  }

  /**
   * Detect circular dependencies using DFS
   * Returns all cycles found in the dependency graph
   */
  async detectCircularDependencies(): Promise<CircularDependency[]> {
    // Get all dependencies
    const query = `
      SELECT
        sd.id,
        sd.source_service_id,
        sd.target_service_id,
        ss.name as source_name,
        ts.name as target_name
      FROM service_dependencies sd
      JOIN services ss ON sd.source_service_id = ss.id
      JOIN services ts ON sd.target_service_id = ts.id
    `;

    const result = await pool.query(query);
    const dependencies = result.rows;

    // Build adjacency list
    const graph: Map<string, string[]> = new Map();
    const serviceNames: Map<string, string> = new Map();

    dependencies.forEach((dep) => {
      if (!graph.has(dep.source_service_id)) {
        graph.set(dep.source_service_id, []);
      }
      graph.get(dep.source_service_id)!.push(dep.target_service_id);

      serviceNames.set(dep.source_service_id, dep.source_name);
      serviceNames.set(dep.target_service_id, dep.target_name);
    });

    // DFS to find cycles
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string) => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          // Cycle detected
          const cycleStartIndex = path.indexOf(neighbor);
          const cycle = path.slice(cycleStartIndex);

          // Build human-readable path
          const pathParts = cycle.map((id) => serviceNames.get(id) || id);
          const cyclePath = pathParts.join(' → ') + ` → ${serviceNames.get(neighbor)}`;

          // Avoid duplicate cycles (same cycle in different order)
          const cycleKey = [...cycle].sort().join(',');
          const isDuplicate = cycles.some(c => {
            const existingKey = c.cycle.map(s => s.service_id).sort().join(',');
            return existingKey === cycleKey;
          });

          if (!isDuplicate) {
            cycles.push({
              cycle: cycle.map((id) => ({
                service_id: id,
                service_name: serviceNames.get(id) || id,
              })),
              path: cyclePath,
              dependency_ids: [],
              severity: 'error',
            });
          }
        }
      }

      path.pop();
      recStack.delete(node);
    };

    // Run DFS from each unvisited node
    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Get dependencies for a specific service (both directions)
   */
  async getServiceDependencies(serviceId: string): Promise<{
    upstream: ServiceDependency[];
    downstream: ServiceDependency[];
  }> {
    const upstreamQuery = `
      SELECT
        sd.*,
        ss.name as source_service_name,
        ts.name as target_service_name,
        ss.status as source_service_status,
        ts.status as target_service_status
      FROM service_dependencies sd
      LEFT JOIN services ss ON sd.source_service_id = ss.id
      LEFT JOIN services ts ON sd.target_service_id = ts.id
      WHERE sd.source_service_id = $1
    `;

    const downstreamQuery = `
      SELECT
        sd.*,
        ss.name as source_service_name,
        ts.name as target_service_name,
        ss.status as source_service_status,
        ts.status as target_service_status
      FROM service_dependencies sd
      LEFT JOIN services ss ON sd.source_service_id = ss.id
      LEFT JOIN services ts ON sd.target_service_id = ts.id
      WHERE sd.target_service_id = $1
    `;

    const [upstreamResult, downstreamResult] = await Promise.all([
      pool.query(upstreamQuery, [serviceId]),
      pool.query(downstreamQuery, [serviceId]),
    ]);

    return {
      upstream: upstreamResult.rows,
      downstream: downstreamResult.rows,
    };
  }
}
