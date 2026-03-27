import { Router } from 'express';
import { AIReportsController } from '../controllers/ai-reports.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new AIReportsController();

/**
 * AI Reports Routes
 * All routes require authentication
 */

// Generate report on-demand (Pro and Enterprise tiers)
router.post('/generate', authenticateToken, (req, res) => controller.generateReport(req, res));

// Get report history
router.get('/history', authenticateToken, (req, res) => controller.getReportHistory(req, res));

// Get single report by ID
router.get('/:id', authenticateToken, (req, res) => controller.getReport(req, res));

// Bulk delete reports (must be before /:id to avoid routing conflict)
router.delete('/bulk', authenticateToken, (req, res) => controller.bulkDeleteReports(req, res));

// Delete report
router.delete('/:id', authenticateToken, (req, res) => controller.deleteReport(req, res));

export default router;
