import { Router } from 'express';
import { ServicesController } from '../controllers/services.controller';
import { validateBody, validateParams } from '../middleware/validation';
import { createServiceSchema, updateServiceSchema, uuidParamSchema } from '../validators/schemas';

const router = Router();
const controller = new ServicesController();

router.get('/', (req, res, next) => controller.getAll(req, res, next));
router.get('/:id', validateParams(uuidParamSchema), (req, res, next) => controller.getById(req, res, next));
router.post('/', validateBody(createServiceSchema), (req, res, next) => controller.create(req, res, next));
router.put('/:id', validateParams(uuidParamSchema), validateBody(updateServiceSchema), (req, res, next) => controller.update(req, res, next));
router.delete('/:id', validateParams(uuidParamSchema), (req, res, next) => controller.delete(req, res, next));

export default router;
