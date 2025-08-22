import { Router } from "express";
import IndexController from "./controllers/IndexController";

const router = Router();

router.get('/', IndexController.index);

export default router;