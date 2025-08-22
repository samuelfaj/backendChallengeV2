import { Router } from "express";
import IndexController from "./controllers/IndexController";
import VideoProgressController from "./controllers/VideoProgressController";

const router = Router();

// Basic route
router.get('/', IndexController.index);
router.get('/error', IndexController.error);

// Video Progress API Routes
router.post('/video/sessions', VideoProgressController.startSession);
router.post('/video/sessions/:sessionId/progress', VideoProgressController.recordProgress);
router.post('/video/sessions/bulk-progress', VideoProgressController.bulkProgress);
router.put('/video/sessions/:sessionId/heartbeat', VideoProgressController.heartbeat);
router.put('/video/sessions/:sessionId/close', VideoProgressController.closeSession);

// Lesson Progress Routes
router.put('/video/attempts/:attemptId/complete', VideoProgressController.markComplete);
router.get('/video/users/:userId/lessons/:lessonId/progress', VideoProgressController.getLessonProgress);
router.get('/video/users/:userId/unassigned-history', VideoProgressController.getUnassignedHistory);

// Analytics Routes
router.get('/video/sessions/:sessionId/skip-analytics', VideoProgressController.getSkipAnalytics);

export default router;