import { pool } from '../config/database';
import { Team, Service, CreateTeamRequest } from '../types';

export class TeamsRepository {
  async findAll(organizationId: string): Promise<Team[]> {
    const result = await pool.query(
      'SELECT * FROM teams WHERE organization_id = $1 ORDER BY created_at DESC',
      [organizationId]
    );
    return result.rows;
  }

  async findById(id: string, organizationId: string): Promise<Team | null> {
    const result = await pool.query(
      'SELECT * FROM teams WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    return result.rows[0] || null;
  }

  async create(team: CreateTeamRequest, organizationId: string): Promise<Team> {
    const query = `
      INSERT INTO teams (name, owner, description, organization_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const result = await pool.query(query, [
      team.name,
      team.owner,
      team.description,
      organizationId,
    ]);
    return result.rows[0];
  }

  // Callers must still verify the team belongs to the caller's org (e.g. via
  // findById). The service rows are scoped to the org here as well — team_id
  // alone doesn't carry org scope.
  async findServicesByTeamId(teamId: string, organizationId: string): Promise<Service[]> {
    const result = await pool.query(
      'SELECT * FROM services WHERE team_id = $1 AND organization_id = $2 ORDER BY created_at DESC',
      [teamId, organizationId]
    );
    return result.rows;
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM teams WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    return result.rowCount ? result.rowCount > 0 : false;
  }
}
