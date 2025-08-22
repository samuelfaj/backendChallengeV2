import { Router } from "express";
import IndexController from "./controllers/IndexController";

const router = Router();

router.get('/', IndexController.index);
router.get('/error', IndexController.error);

export default router;