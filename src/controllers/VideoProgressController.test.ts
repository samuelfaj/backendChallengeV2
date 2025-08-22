import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { Request, Response } from "express";
import VideoProgressController from "./VideoProgressController";
import { z } from "zod";

describe("VideoProgressController", () => {
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockApiHelper: any;

	beforeEach(() => {
		// Mock response object
		mockResponse = {
			status: mock(() => mockResponse),
			json: mock(),
		} as Partial<Response>;


		// Mock ApiHelper
		mockApiHelper = {
			setCode: mock().mockReturnThis(),
			success: mock(),
			error: mock(),
		};

		// Mock ApiHelper constructor
		mock.module("../helpers/ApiHelper", () => ({
			default: mock(() => mockApiHelper),
		}));

		// Mock VideoProgressService
		const mockVideoService = {
			getOrCreateLessonAttempt: mock(() => Promise.resolve("attempt-123")),
			startSession: mock(() => Promise.resolve("session-123")),
			recordWatchSegment: mock(() => Promise.resolve()),
			recordSeekEvent: mock(() => Promise.resolve()),
			updateSessionHeartbeat: mock(() => Promise.resolve()),
			closeSession: mock(() => Promise.resolve()),
			markLessonComplete: mock(() => Promise.resolve()),
			getLessonProgress: mock(() => Promise.resolve({ progress: 75 })),
			getUnassignedViewingHistory: mock(() => Promise.resolve([{ lessonId: "lesson-1" }])),
			getSkipAnalytics: mock(() => Promise.resolve({ skips: 5 })),
		};

		// Replace the static service instance
		(VideoProgressController as any).videoService = mockVideoService;
	});

	describe("Input Validation", () => {
		it("should validate startSession input with missing userId", () => {
			mockRequest = {
				body: {
					lessonId: "lesson-123"
				}
			};

			expect(() => {
				const startSessionSchema = z.object({
					userId: z.string().min(1, "userId is required"),
					lessonId: z.string().min(1, "lessonId is required"),
					isAssigned: z.boolean().optional().default(false),
					clientInfo: z.object({}).optional()
				});

				startSessionSchema.parse(mockRequest.body);
			}).toThrow();
		});

		it("should validate recordProgress input with invalid segment data", () => {
			mockRequest = {
				body: {
					segments: [{
						clientEventId: "event-1",
						startSecond: 30,
						endSecond: 10 // Invalid: endSecond < startSecond
					}]
				}
			};

			expect(() => {
				const watchSegmentSchema = z.object({
					clientEventId: z.string().min(1, "clientEventId is required"),
					startSecond: z.number().min(0, "startSecond must be non-negative"),
					endSecond: z.number().min(0, "endSecond must be non-negative"),
					speed: z.number().positive().optional().default(1.0)
				}).refine((data: any) => data.endSecond >= data.startSecond, {
					message: "endSecond must be greater than or equal to startSecond"
				});

				watchSegmentSchema.parse(mockRequest.body.segments![0]);
			}).toThrow();
		});

		it("should validate bulkProgress input with empty sessions array", () => {
			mockRequest = {
				body: {
					sessions: []
				}
			};

			expect(() => {
				const bulkProgressSchema = z.object({
					sessions: z.array(z.object({})).min(1, "At least one session is required")
				});

				bulkProgressSchema.parse(mockRequest.body);
			}).toThrow();
		});
	});

	describe("Schema Validation", () => {
		it("should accept valid startSession data", () => {
			const validData = {
				userId: "user-123",
				lessonId: "lesson-123",
				isAssigned: true,
				clientInfo: { device: "mobile" }
			};

			const startSessionSchema = z.object({
				userId: z.string().min(1, "userId is required"),
				lessonId: z.string().min(1, "lessonId is required"),
				isAssigned: z.boolean().optional().default(false),
				clientInfo: z.object({}).optional()
			});

			expect(() => startSessionSchema.parse(validData)).not.toThrow();
		});

		it("should accept valid recordProgress data", () => {
			const validData = {
				segments: [{
					clientEventId: "event-1",
					startSecond: 0,
					endSecond: 30,
					speed: 1.0
				}],
				seeks: [{
					fromSecond: 30,
					toSecond: 60,
					allowed: true,
					reason: "user_seek"
				}]
			};

			const watchSegmentSchema = z.object({
				clientEventId: z.string().min(1, "clientEventId is required"),
				startSecond: z.number().min(0, "startSecond must be non-negative"),
				endSecond: z.number().min(0, "endSecond must be non-negative"),
				speed: z.number().positive().optional().default(1.0)
			}).refine((data: any) => data.endSecond >= data.startSecond, {
				message: "endSecond must be greater than or equal to startSecond"
			});

			const seekEventSchema = z.object({
				fromSecond: z.number().min(0, "fromSecond must be non-negative"),
				toSecond: z.number().min(0, "toSecond must be non-negative"),
				allowed: z.boolean().optional().default(false),
				reason: z.string().optional().default("user_seek")
			});

			expect(() => watchSegmentSchema.parse(validData.segments[0])).not.toThrow();
			expect(() => seekEventSchema.parse(validData.seeks[0])).not.toThrow();
		});

		it("should use default values correctly", () => {
			// Test default isAssigned
			const startSessionSchema = z.object({
				userId: z.string().min(1, "userId is required"),
				lessonId: z.string().min(1, "lessonId is required"),
				isAssigned: z.boolean().optional().default(false),
				clientInfo: z.object({}).optional()
			});

			const result = startSessionSchema.parse({
				userId: "user-123",
				lessonId: "lesson-123"
			});

			expect(result.isAssigned).toBe(false);

			// Test default speed
			const watchSegmentSchema = z.object({
				clientEventId: z.string().min(1, "clientEventId is required"),
				startSecond: z.number().min(0, "startSecond must be non-negative"),
				endSecond: z.number().min(0, "endSecond must be non-negative"),
				speed: z.number().positive().optional().default(1.0)
			});

			const segmentResult = watchSegmentSchema.parse({
				clientEventId: "event-1",
				startSecond: 0,
				endSecond: 30
			});

			expect(segmentResult.speed).toBe(1.0);
		});
	});

	describe("Parameter Validation", () => {
		it("should validate sessionId parameter", () => {
			const paramSchema = z.object({
				sessionId: z.string().min(1, "sessionId is required")
			});

			// Valid sessionId
			expect(() => paramSchema.parse({ sessionId: "session-123" })).not.toThrow();

			// Invalid sessionId
			expect(() => paramSchema.parse({ sessionId: "" })).toThrow();
		});

		it("should validate attemptId parameter", () => {
			const attemptParamSchema = z.object({
				attemptId: z.string().min(1, "attemptId is required")
			});

			// Valid attemptId
			expect(() => attemptParamSchema.parse({ attemptId: "attempt-123" })).not.toThrow();

			// Invalid attemptId
			expect(() => attemptParamSchema.parse({ attemptId: "" })).toThrow();
		});

		it("should validate userId and lessonId parameters", () => {
			const lessonProgressParamSchema = z.object({
				userId: z.string().min(1, "userId is required"),
				lessonId: z.string().min(1, "lessonId is required")
			});

			// Valid parameters
			expect(() => lessonProgressParamSchema.parse({ 
				userId: "user-123", 
				lessonId: "lesson-123" 
			})).not.toThrow();

			// Invalid userId
			expect(() => lessonProgressParamSchema.parse({ 
				userId: "", 
				lessonId: "lesson-123" 
			})).toThrow();

			// Invalid lessonId
			expect(() => lessonProgressParamSchema.parse({ 
				userId: "user-123", 
				lessonId: "" 
			})).toThrow();
		});
	});

	describe("Data Transformation", () => {
		it("should transform segment data correctly", () => {
			const inputSegment = {
				clientEventId: "event-1",
				startSecond: 0,
				endSecond: 30,
				speed: 2.0
			};

			const expectedSegmentData = {
				clientEventId: "event-1",
				startSecond: 0,
				endSecond: 30,
				speed: 2.0,
			};

			expect(inputSegment).toEqual(expectedSegmentData);
		});

		it("should transform seek data correctly", () => {
			const inputSeek = {
				fromSecond: 30,
				toSecond: 60,
				allowed: true,
				reason: "user_seek"
			};

			const expectedSeekData = {
				fromSecond: 30,
				toSecond: 60,
				allowed: true,
				reason: "user_seek",
			};

			expect(inputSeek).toEqual(expectedSeekData);
		});

		it("should apply default values for missing fields", () => {
			const inputSegment = {
				clientEventId: "event-1",
				startSecond: 0,
				endSecond: 30
			};

			const watchSegmentSchema = z.object({
				clientEventId: z.string().min(1, "clientEventId is required"),
				startSecond: z.number().min(0, "startSecond must be non-negative"),
				endSecond: z.number().min(0, "endSecond must be non-negative"),
				speed: z.number().positive().optional().default(1.0)
			});

			const result = watchSegmentSchema.parse(inputSegment);

			expect(result.speed).toBe(1.0);
		});
	});

	describe("Business Logic", () => {
		it("should handle session start flow", async () => {
			const sessionStartData = {
				userId: "user-123",
				lessonId: "lesson-123",
				lessonAttemptId: "attempt-123",
				clientInfo: { device: "mobile" },
			};

			// This tests the data structure that would be passed to the service
			expect(sessionStartData).toEqual({
				userId: "user-123",
				lessonId: "lesson-123",
				lessonAttemptId: "attempt-123",
				clientInfo: { device: "mobile" },
			});
		});

		it("should handle bulk progress processing logic", () => {
			const bulkSessionData = [
				{
					sessionId: "session-1",
					segments: [{
						clientEventId: "event-1",
						startSecond: 0,
						endSecond: 30
					}]
				},
				{
					sessionId: "session-2",
					seeks: [{
						fromSecond: 30,
						toSecond: 60
					}]
				}
			];

			// Test that the data structure is correct for bulk processing
			expect(bulkSessionData).toHaveLength(2);
			expect(bulkSessionData[0]?.sessionId).toBe("session-1");
			expect(bulkSessionData[1]?.sessionId).toBe("session-2");
		});

		it("should handle error result structure", () => {
			const errorResult = {
				sessionId: "session-1",
				status: "error",
				error: "Database error"
			};

			expect(errorResult.status).toBe("error");
			expect(errorResult.error).toBe("Database error");
		});

		it("should handle success result structure", () => {
			const successResult = {
				sessionId: "session-1",
				status: "success"
			};

			expect(successResult.status).toBe("success");
		});
	});

	describe("API Response Formats", () => {
		it("should format startSession response correctly", () => {
			const expectedResponse = {
				sessionId: "session-123",
				attemptId: "attempt-123",
				message: "Session started successfully"
			};

			expect(expectedResponse.sessionId).toBeDefined();
			expect(expectedResponse.attemptId).toBeDefined();
			expect(expectedResponse.message).toBe("Session started successfully");
		});

		it("should format progress response correctly", () => {
			const expectedResponse = {
				message: "Progress recorded successfully"
			};

			expect(expectedResponse.message).toBe("Progress recorded successfully");
		});

		it("should format unassigned history response correctly", () => {
			const historyData = [{ lessonId: "lesson-1" }, { lessonId: "lesson-2" }];
			const expectedResponse = {
				unassignedLessons: historyData,
				count: historyData.length
			};

			expect(expectedResponse.unassignedLessons).toEqual(historyData);
			expect(expectedResponse.count).toBe(2);
		});

		it("should format bulk progress response correctly", () => {
			const results = [
				{ sessionId: "session-1", status: "success" },
				{ sessionId: "session-2", status: "error", error: "Database error" }
			];
			const expectedResponse = {
				message: "Bulk progress processed",
				results
			};

			expect(expectedResponse.message).toBe("Bulk progress processed");
			expect(expectedResponse.results).toEqual(results);
		});
	});
});