import { Request, Response } from 'express';
import { TeamsRepository } from '../repositories/teams.repository';
import { CreateTeamRequest, ApiResponse } from '../types';

const repository = new TeamsRepository();

export class TeamsController {
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      const teams = await repository.findAll(organizationId);

      const response: ApiResponse = {
        success: true,
        data: teams,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching teams:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch teams',
      };
      res.status(500).json(response);
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;
      const team = await repository.findById(id, organizationId);

      if (!team) {
        const response: ApiResponse = {
          success: false,
          error: 'Team not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: team,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching team:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch team',
      };
      res.status(500).json(response);
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const teamData: CreateTeamRequest = req.body;

      // Validate required fields
      if (!teamData.name || !teamData.owner) {
        const response: ApiResponse = {
          success: false,
          error: 'Missing required fields: name, owner',
        };
        res.status(400).json(response);
        return;
      }

      const organizationId = (req as any).user?.organizationId;
      const team = await repository.create(teamData, organizationId);

      const response: ApiResponse = {
        success: true,
        data: team,
        message: 'Team created successfully',
      };

      res.status(201).json(response);
    } catch (error) {
      console.error('Error creating team:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to create team',
      };
      res.status(500).json(response);
    }
  }

  async getTeamServices(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;

      // First check if team exists (and belongs to the caller's org)
      const team = await repository.findById(id, organizationId);
      if (!team) {
        const response: ApiResponse = {
          success: false,
          error: 'Team not found',
        };
        res.status(404).json(response);
        return;
      }

      const services = await repository.findServicesByTeamId(id);

      const response: ApiResponse = {
        success: true,
        data: services,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching team services:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch team services',
      };
      res.status(500).json(response);
    }
  }

  async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;
      const deleted = await repository.delete(id, organizationId);

      if (!deleted) {
        const response: ApiResponse = {
          success: false,
          error: 'Team not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        message: 'Team deleted successfully',
      };

      res.json(response);
    } catch (error) {
      console.error('Error deleting team:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to delete team',
      };
      res.status(500).json(response);
    }
  }
}
