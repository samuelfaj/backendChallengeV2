import type { Request, Response } from "express";
import { z } from "zod";
import ApiHelper from "../helpers/ApiHelper";
import asyncHandler from "../helpers/AsyncHandler";
import VideoProgressService from "../services/VideoProgressService";
import type { 
	SessionStartData, 
	WatchSegmentData, 
	SeekEventData 
} from "../services/VideoProgressService";

export default class VideoProgressController {
	private static videoService = new VideoProgressService();

	static startSession = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const startSessionSchema = z.object({
			userId: z.string().min(1, "userId is required"),
			lessonId: z.string().min(1, "lessonId is required"),
			isAssigned: z.boolean().optional().default(false),
			clientInfo: z.object({}).optional()
		});

		const validatedBody = startSessionSchema.parse(req.body);
		const { userId, lessonId, isAssigned, clientInfo } = validatedBody;

		// Get or create lesson attempt
		const attemptId = await VideoProgressController.videoService
			.getOrCreateLessonAttempt(userId, lessonId, isAssigned);

		// Start new session
		const sessionData: SessionStartData = {
			userId,
			lessonId,
			lessonAttemptId: attemptId,
			clientInfo,
		};

		const sessionId = await VideoProgressController.videoService
			.startSession(sessionData);

		helper.setCode(ApiHelper.CREATED).success({
			sessionId,
			attemptId,
			message: "Session started successfully"
		});
	});

	static recordProgress = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const paramSchema = z.object({
			sessionId: z.string().min(1, "sessionId is required")
		});

		const watchSegmentSchema = z.object({
			clientEventId: z.string().min(1, "clientEventId is required"),
			startSecond: z.number().min(0, "startSecond must be non-negative"),
			endSecond: z.number().min(0, "endSecond must be non-negative"),
			speed: z.number().positive().optional().default(1.0)
		}).refine(data => data.endSecond >= data.startSecond, {
			message: "endSecond must be greater than or equal to startSecond"
		});

		const seekEventSchema = z.object({
			fromSecond: z.number().min(0, "fromSecond must be non-negative"),
			toSecond: z.number().min(0, "toSecond must be non-negative"),
			allowed: z.boolean().optional().default(false),
			reason: z.string().optional().default("user_seek")
		});

		const recordProgressSchema = z.object({
			segments: z.array(watchSegmentSchema).optional(),
			seeks: z.array(seekEventSchema).optional()
		});

		const validatedParams = paramSchema.parse(req.params);
		const validatedBody = recordProgressSchema.parse(req.body);
		const { sessionId } = validatedParams;
		const { segments, seeks } = validatedBody;

		// Record watch segments
		if (segments && Array.isArray(segments)) {
			for (const segment of segments) {
				const segmentData: WatchSegmentData = {
					clientEventId: segment.clientEventId,
					startSecond: segment.startSecond,
					endSecond: segment.endSecond,
					speed: segment.speed || 1.0,
				};
				
				await VideoProgressController.videoService
					.recordWatchSegment(sessionId, segmentData);
			}
		}

		// Record seek events
		if (seeks && Array.isArray(seeks)) {
			for (const seek of seeks) {
				const seekData: SeekEventData = {
					fromSecond: seek.fromSecond,
					toSecond: seek.toSecond,
					allowed: seek.allowed || false,
					reason: seek.reason || "user_seek",
				};
				
				await VideoProgressController.videoService
					.recordSeekEvent(sessionId, seekData);
			}
		}

		// Update heartbeat
		await VideoProgressController.videoService
			.updateSessionHeartbeat(sessionId);

		helper.setCode(ApiHelper.OK).success({ message: "Progress recorded successfully" });
	});

	static closeSession = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const paramSchema = z.object({
			sessionId: z.string().min(1, "sessionId is required")
		});

		const validatedParams = paramSchema.parse(req.params);
		const { sessionId } = validatedParams;

		await VideoProgressController.videoService.closeSession(sessionId);
		
		helper.setCode(ApiHelper.OK).success({ message: "Session closed successfully" });
	});

	static markComplete = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const attemptParamSchema = z.object({
			attemptId: z.string().min(1, "attemptId is required")
		});

		const validatedParams = attemptParamSchema.parse(req.params);
		const { attemptId } = validatedParams;

		await VideoProgressController.videoService.markLessonComplete(attemptId);
		
		helper.setCode(ApiHelper.OK).success({ message: "Lesson marked as complete" });
	});

	static getLessonProgress = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const lessonProgressParamSchema = z.object({
			userId: z.string().min(1, "userId is required"),
			lessonId: z.string().min(1, "lessonId is required")
		});

		const validatedParams = lessonProgressParamSchema.parse(req.params);
		const { userId, lessonId } = validatedParams;

		const progress = await VideoProgressController.videoService
			.getLessonProgress(userId, lessonId);

		if (!progress) {
			return helper.setCode(ApiHelper.NOT_FOUND).error(new Error("No progress found for this lesson"));
		}

		helper.setCode(ApiHelper.OK).success(progress);
	});

	static getUnassignedHistory = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const userIdParamSchema = z.object({
			userId: z.string().min(1, "userId is required")
		});

		const validatedParams = userIdParamSchema.parse(req.params);
		const { userId } = validatedParams;

		const history = await VideoProgressController.videoService
			.getUnassignedViewingHistory(userId);

		helper.setCode(ApiHelper.OK).success({
			unassignedLessons: history,
			count: history.length
		});
	});

	static getSkipAnalytics = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const paramSchema = z.object({
			sessionId: z.string().min(1, "sessionId is required")
		});

		const validatedParams = paramSchema.parse(req.params);
		const { sessionId } = validatedParams;

		const analytics = await VideoProgressController.videoService
			.getSkipAnalytics(sessionId);

		helper.setCode(ApiHelper.OK).success(analytics);
	});

	static heartbeat = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const paramSchema = z.object({
			sessionId: z.string().min(1, "sessionId is required")
		});

		const validatedParams = paramSchema.parse(req.params);
		const { sessionId } = validatedParams;

		await VideoProgressController.videoService
			.updateSessionHeartbeat(sessionId);

		helper.setCode(ApiHelper.OK).success({ message: "Heartbeat updated" });
	});

	static bulkProgress = asyncHandler(async (req: Request, res: Response) => {
		const helper = new ApiHelper(res);
		
		const watchSegmentSchema = z.object({
			clientEventId: z.string().min(1, "clientEventId is required"),
			startSecond: z.number().min(0, "startSecond must be non-negative"),
			endSecond: z.number().min(0, "endSecond must be non-negative"),
			speed: z.number().positive().optional().default(1.0)
		}).refine(data => data.endSecond >= data.startSecond, {
			message: "endSecond must be greater than or equal to startSecond"
		});

		const seekEventSchema = z.object({
			fromSecond: z.number().min(0, "fromSecond must be non-negative"),
			toSecond: z.number().min(0, "toSecond must be non-negative"),
			allowed: z.boolean().optional().default(false),
			reason: z.string().optional().default("user_seek")
		});

		const bulkSessionSchema = z.object({
			sessionId: z.string().min(1, "sessionId is required"),
			segments: z.array(watchSegmentSchema).optional(),
			seeks: z.array(seekEventSchema).optional()
		});

		const bulkProgressSchema = z.object({
			sessions: z.array(bulkSessionSchema).min(1, "At least one session is required")
		});

		const validatedBody = bulkProgressSchema.parse(req.body);
		const { sessions } = validatedBody;

		const results = [];
		
		for (const session of sessions) {
			try {
				const { sessionId, segments, seeks } = session;
				
				// Record segments
				if (segments) {
					for (const segment of segments) {
						const segmentData: WatchSegmentData = {
							clientEventId: segment.clientEventId,
							startSecond: segment.startSecond,
							endSecond: segment.endSecond,
							speed: segment.speed || 1.0,
						};
						
						await VideoProgressController.videoService
							.recordWatchSegment(sessionId, segmentData);
					}
				}

				// Record seeks
				if (seeks) {
					for (const seek of seeks) {
						const seekData: SeekEventData = {
							fromSecond: seek.fromSecond,
							toSecond: seek.toSecond,
							allowed: seek.allowed || false,
							reason: seek.reason || "user_seek",
						};
						
						await VideoProgressController.videoService
							.recordSeekEvent(sessionId, seekData);
					}
				}

				// Update heartbeat
				await VideoProgressController.videoService
					.updateSessionHeartbeat(sessionId);

				results.push({ sessionId, status: "success" });
			} catch (error) {
				results.push({ 
					sessionId: session.sessionId, 
					status: "error", 
					error: (error as Error).message 
				});
			}
		}

		helper.setCode(ApiHelper.OK).success({ 
			message: "Bulk progress processed",
			results 
		});
	});
}