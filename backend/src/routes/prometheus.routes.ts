import { Router } from 'express'
import { PrometheusController } from '../controllers/prometheus.controller'

const router = Router()
const controller = new PrometheusController()

// Prometheus proxy endpoints
router.get('/query', controller.query.bind(controller))
router.get('/query_range', controller.queryRange.bind(controller))
router.get('/targets', controller.targets.bind(controller))
router.get('/health', controller.health.bind(controller))
router.get('/config', controller.config.bind(controller))

export default router
