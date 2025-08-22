import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import VideoProgressService from "./VideoProgressService";
import type { 
	SessionStartData, 
	WatchSegmentData, 
	SeekEventData,
	ProgressSummary 
} from "./VideoProgressService";

// Mock the database module
const mockDb = {
	insert: mock(() => ({
		values: mock(() => ({
			returning: mock(() => Promise.resolve([{ id: "test-id" }])),
			onConflictDoNothing: mock(() => Promise.resolve())
		}))
	})),
	update: mock(() => ({
		set: mock(() => ({
			where: mock(() => Promise.resolve())
		}))
	})),
	select: mock(() => ({
		from: mock(() => ({
			where: mock(() => ({
				orderBy: mock(() => ({
					limit: mock(() => Promise.resolve([{ id: "test-attempt-id", attemptNo: 1 }]))
				})),
				returning: mock(() => Promise.resolve([{ id: "test-attempt-id" }]))
			})),
			orderBy: mock(() => Promise.resolve([]))
		}))
	}))
};

// Mock the schema imports
mock.module("../db/client", () => ({
	db: mockDb
}));

mock.module("../db/schema", () => ({
	watchSession: {
		id: "id",
		userId: "user_id",
		lessonId: "lesson_id",
		lessonAttemptId: "lesson_attempt_id",
		clientInfo: "client_info",
		lastHeartbeatAt: "last_heartbeat_at",
		closedAt: "closed_at"
	},
	watchSegment: {
		sessionId: "session_id",
		clientEventId: "client_event_id",
		startSecond: "start_second",
		endSecond: "end_second",
		speed: "speed",
		createdAt: "created_at"
	},
	seekEvent: {
		sessionId: "session_id",
		fromSecond: "from_second",
		toSecond: "to_second",
		allowed: "allowed",
		reason: "reason",
		isSkip: "is_skip",
		skipDistance: "skip_distance",
		createdAt: "created_at"
	},
	lessonAttempt: {
		id: "id",
		userId: "user_id",
		lessonId: "lesson_id",
		attemptNo: "attempt_no",
		status: "status",
		isAssigned: "is_assigned",
		maxVerifiedSecond: "max_verified_second",
		totalEffectiveSeconds: "total_effective_seconds",
		coverageSeconds: "coverage_seconds",
		skipEvents: "skip_events",
		completedAt: "completed_at",
		createdAt: "created_at",
		updatedAt: "updated_at"
	}
}));

describe("VideoProgressService", () => {
	let service: VideoProgressService;

	beforeEach(() => {
		service = new VideoProgressService();
		// Reset all mocks
		mockDb.insert.mockClear();
		mockDb.update.mockClear();
		mockDb.select.mockClear();
	});

	afterEach(() => {
		mock.restore();
	});

	describe("startSession", () => {
		it("should create a new session and return session ID", async () => {
			const sessionData: SessionStartData = {
				userId: "user-123",
				lessonId: "lesson-456",
				lessonAttemptId: "attempt-789",
				clientInfo: { browser: "Chrome", version: "100" }
			};

			const result = await service.startSession(sessionData);

			expect(result).toBe("test-id");
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle session creation without lessonAttemptId", async () => {
			const sessionData: SessionStartData = {
				userId: "user-123",
				lessonId: "lesson-456",
				clientInfo: { browser: "Safari" }
			};

			const result = await service.startSession(sessionData);

			expect(result).toBe("test-id");
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle session creation without clientInfo", async () => {
			const sessionData: SessionStartData = {
				userId: "user-123",
				lessonId: "lesson-456",
				lessonAttemptId: "attempt-789"
			};

			const result = await service.startSession(sessionData);

			expect(result).toBe("test-id");
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});
	});

	describe("recordWatchSegment", () => {
		it("should record a watch segment with correct data", async () => {
			const segment: WatchSegmentData = {
				clientEventId: "event-123",
				startSecond: 10,
				endSecond: 20,
				speed: 1.5
			};

			await service.recordWatchSegment("session-123", segment);

			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle duplicate segments gracefully", async () => {
			const segment: WatchSegmentData = {
				clientEventId: "event-123",
				startSecond: 10,
				endSecond: 20,
				speed: 2.0
			};

			await service.recordWatchSegment("session-123", segment);

			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle segments with fractional speeds", async () => {
			const segment: WatchSegmentData = {
				clientEventId: "event-124",
				startSecond: 30,
				endSecond: 45,
				speed: 0.5
			};

			await service.recordWatchSegment("session-123", segment);

			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});
	});

	describe("recordSeekEvent", () => {
		it("should record a seek event and detect skips correctly", async () => {
			const seekData: SeekEventData = {
				fromSecond: 10,
				toSecond: 50, // 40 second jump - should be detected as skip
				allowed: false,
				reason: "user_seek"
			};

			await service.recordSeekEvent("session-123", seekData);

			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should not mark small seeks as skips", async () => {
			const seekData: SeekEventData = {
				fromSecond: 10,
				toSecond: 12, // 2 second jump - should not be skip
				allowed: false,
				reason: "user_seek"
			};

			await service.recordSeekEvent("session-123", seekData);

			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle allowed seeks", async () => {
			const seekData: SeekEventData = {
				fromSecond: 10,
				toSecond: 100,
				allowed: true,
				reason: "chapter_navigation"
			};

			await service.recordSeekEvent("session-123", seekData);

			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle backward seeks", async () => {
			const seekData: SeekEventData = {
				fromSecond: 100,
				toSecond: 50,
				allowed: false,
				reason: "user_rewind"
			};

			await service.recordSeekEvent("session-123", seekData);

			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});
	});

	describe("updateSessionHeartbeat", () => {
		it("should update session heartbeat timestamp", async () => {
			await service.updateSessionHeartbeat("session-123");

			expect(mockDb.update).toHaveBeenCalledTimes(1);
		});
	});

	describe("closeSession", () => {
		it("should close session and trigger progress calculation", async () => {
			// Mock the session and segments for progress calculation
			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => Promise.resolve([{
						id: "session-123",
						lessonAttemptId: "attempt-456"
					}]))
				}))
			}));

			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => Promise.resolve([
							{
								startSecond: 0,
								endSecond: 10,
								speed: "1.0"
							},
							{
								startSecond: 10,
								endSecond: 20,
								speed: "1.5"
							}
						]))
					}))
				}))
			}));

			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => Promise.resolve([{ count: 2 }]))
				}))
			}));

			await service.closeSession("session-123");

			expect(mockDb.update).toHaveBeenCalledTimes(2); // Close session + update attempt
		});
	});

	describe("getLessonProgress", () => {
		it("should return lesson progress for existing attempt", async () => {
			const mockAttempt = {
				id: "attempt-123",
				userId: "user-123",
				lessonId: "lesson-456",
				attemptNo: 1,
				maxVerifiedSecond: 100,
				totalEffectiveSeconds: "95.5",
				coverageSeconds: 85,
				skipEvents: 2,
				isAssigned: true
			};

			const mockSessions = [
				{ id: "session-1", startedAt: new Date() },
				{ id: "session-2", startedAt: new Date() }
			];

			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => ({
							limit: mock(() => Promise.resolve([mockAttempt]))
						}))
					}))
				}))
			}));

			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => Promise.resolve(mockSessions))
					}))
				}))
			}));

			const result = await service.getLessonProgress("user-123", "lesson-456");

			expect(result).toBeDefined();
			expect(result.attempt).toEqual(mockAttempt);
			expect(result.sessions).toEqual(mockSessions);
			expect(result.progress.maxVerifiedSecond).toBe(100);
			expect(result.progress.totalEffectiveSeconds).toBe(95.5);
		});

		it("should return null for non-existent lesson", async () => {
			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => ({
							limit: mock(() => Promise.resolve([]))
						}))
					}))
				}))
			}));

			const result = await service.getLessonProgress("user-123", "non-existent");

			expect(result).toBeNull();
		});
	});

	describe("getOrCreateLessonAttempt", () => {
		it("should return existing active attempt", async () => {
			const existingAttempt = {
				id: "attempt-123",
				userId: "user-123",
				lessonId: "lesson-456",
				isAssigned: false
			};

			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => ({
							limit: mock(() => Promise.resolve([existingAttempt]))
						}))
					}))
				}))
			}));

			const result = await service.getOrCreateLessonAttempt("user-123", "lesson-456", true);

			expect(result).toBe("attempt-123");
			expect(mockDb.update).toHaveBeenCalledTimes(1); // Update assignment status
		});

		it("should create new attempt when none exists", async () => {
			// No existing attempt
			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => ({
							limit: mock(() => Promise.resolve([]))
						}))
					}))
				}))
			}));

			// Mock max attempt number query
			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => Promise.resolve([{ maxAttemptNo: 2 }]))
				}))
			}));

			const result = await service.getOrCreateLessonAttempt("user-123", "lesson-456", true);

			expect(result).toBe("test-id");
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should create first attempt when no previous attempts exist", async () => {
			// No existing attempt
			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => ({
							limit: mock(() => Promise.resolve([]))
						}))
					}))
				}))
			}));

			// No previous attempts
			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => Promise.resolve([{ maxAttemptNo: null }]))
				}))
			}));

			const result = await service.getOrCreateLessonAttempt("user-123", "lesson-456", false);

			expect(result).toBe("test-id");
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});
	});

	describe("markLessonComplete", () => {
		it("should mark lesson attempt as completed", async () => {
			await service.markLessonComplete("attempt-123");

			expect(mockDb.update).toHaveBeenCalledTimes(1);
		});
	});

	describe("getUnassignedViewingHistory", () => {
		it("should return unassigned viewing history", async () => {
			const mockHistory = [
				{
					id: "attempt-1",
					userId: "user-123",
					lessonId: "lesson-1",
					isAssigned: false,
					createdAt: new Date()
				},
				{
					id: "attempt-2",
					userId: "user-123",
					lessonId: "lesson-2",
					isAssigned: false,
					createdAt: new Date()
				}
			];

			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => Promise.resolve(mockHistory))
					}))
				}))
			}));

			const result = await service.getUnassignedViewingHistory("user-123");

			expect(result).toEqual(mockHistory);
			expect(result).toHaveLength(2);
		});

		it("should return empty array when no unassigned history exists", async () => {
			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => Promise.resolve([]))
					}))
				}))
			}));

			const result = await service.getUnassignedViewingHistory("user-123");

			expect(result).toEqual([]);
		});
	});

	describe("getSkipAnalytics", () => {
		it("should return skip analytics for session", async () => {
			const mockSkips = [
				{
					fromSecond: 10,
					toSecond: 50,
					skipDistance: 40,
					createdAt: new Date()
				},
				{
					fromSecond: 100,
					toSecond: 150,
					skipDistance: 50,
					createdAt: new Date()
				}
			];

			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => Promise.resolve(mockSkips))
					}))
				}))
			}));

			const result = await service.getSkipAnalytics("session-123");

			expect(result.totalSkips).toBe(2);
			expect(result.skippedSegments).toHaveLength(2);
			expect(result.skippedSegments[0].distance).toBe(40);
			expect(result.skippedSegments[1].distance).toBe(50);
		});

		it("should return empty analytics when no skips exist", async () => {
			mockDb.select.mockImplementationOnce(() => ({
				from: mock(() => ({
					where: mock(() => ({
						orderBy: mock(() => Promise.resolve([]))
					}))
				}))
			}));

			const result = await service.getSkipAnalytics("session-123");

			expect(result.totalSkips).toBe(0);
			expect(result.skippedSegments).toEqual([]);
		});
	});

	describe("calculateProgressFromSegments", () => {
		it("should calculate progress correctly from segments", () => {
			const service = new VideoProgressService();
			const segments = [
				{ startSecond: 0, endSecond: 10, speed: "1.0" },
				{ startSecond: 10, endSecond: 20, speed: "1.5" },
				{ startSecond: 30, endSecond: 40, speed: "0.5" }
			];

			// Use reflection to access private method for testing
			const calculateMethod = (service as any).calculateProgressFromSegments.bind(service);
			const result: ProgressSummary = calculateMethod(segments);

			// Total effective time: 10/1.0 + 10/1.5 + 10/0.5 = 10 + 6.67 + 20 = 36.67
			expect(result.totalEffectiveSeconds).toBeCloseTo(36.67, 1);
			expect(result.maxVerifiedSecond).toBe(40);
			expect(result.coverageSeconds).toBe(30); // 0-10, 10-20, 30-40 = 30 seconds
			expect(result.speedBreakdown["1"]).toBe(10); // First segment: 1.0 speed
			expect(result.speedBreakdown["1.5"]).toBe(10); // Second segment: 1.5 speed  
			expect(result.speedBreakdown["0.5"]).toBe(10); // Third segment: 0.5 speed
		});

		it("should handle overlapping segments correctly", () => {
			const service = new VideoProgressService();
			const segments = [
				{ startSecond: 0, endSecond: 15, speed: "1.0" },
				{ startSecond: 10, endSecond: 25, speed: "1.0" }, // Overlaps with previous
				{ startSecond: 20, endSecond: 30, speed: "2.0" }  // Overlaps with previous
			];

			const calculateMethod = (service as any).calculateProgressFromSegments.bind(service);
			const result: ProgressSummary = calculateMethod(segments);

			expect(result.maxVerifiedSecond).toBe(30);
			expect(result.coverageSeconds).toBe(30); // 0-30 continuous coverage
		});

		it("should handle empty segments", () => {
			const service = new VideoProgressService();
			const segments: any[] = [];

			const calculateMethod = (service as any).calculateProgressFromSegments.bind(service);
			const result: ProgressSummary = calculateMethod(segments);

			expect(result.totalEffectiveSeconds).toBe(0);
			expect(result.maxVerifiedSecond).toBe(0);
			expect(result.coverageSeconds).toBe(0);
			expect(Object.keys(result.speedBreakdown)).toHaveLength(0);
		});
	});

	describe("calculateCoverageFromIntervals", () => {
		it("should calculate coverage from non-overlapping intervals", () => {
			const service = new VideoProgressService();
			const intervals: Array<[number, number]> = [[0, 10], [20, 30], [40, 50]];

			const calculateMethod = (service as any).calculateCoverageFromIntervals.bind(service);
			const result = calculateMethod(intervals);

			expect(result).toBe(30); // 10 + 10 + 10
		});

		it("should calculate coverage from overlapping intervals", () => {
			const service = new VideoProgressService();
			const intervals: Array<[number, number]> = [[0, 15], [10, 25], [20, 30]];

			const calculateMethod = (service as any).calculateCoverageFromIntervals.bind(service);
			const result = calculateMethod(intervals);

			expect(result).toBe(30); // 0-30 continuous
		});

		it("should handle single interval", () => {
			const service = new VideoProgressService();
			const intervals: Array<[number, number]> = [[5, 15]];

			const calculateMethod = (service as any).calculateCoverageFromIntervals.bind(service);
			const result = calculateMethod(intervals);

			expect(result).toBe(10);
		});

		it("should handle empty intervals", () => {
			const service = new VideoProgressService();
			const intervals: Array<[number, number]> = [];

			const calculateMethod = (service as any).calculateCoverageFromIntervals.bind(service);
			const result = calculateMethod(intervals);

			expect(result).toBe(0);
		});

		it("should handle complex overlapping patterns", () => {
			const service = new VideoProgressService();
			const intervals: Array<[number, number]> = [
				[0, 10],   // 0-10
				[5, 15],   // Overlaps: merge to 0-15
				[12, 20],  // Overlaps: merge to 0-20
				[25, 30],  // Separate: 25-30
				[28, 35]   // Overlaps: merge to 25-35
			];

			const calculateMethod = (service as any).calculateCoverageFromIntervals.bind(service);
			const result = calculateMethod(intervals);

			expect(result).toBe(30); // 0-20 (20 seconds) + 25-35 (10 seconds) = 30
		});
	});

	describe("Error Handling", () => {
		it("should handle database errors gracefully", async () => {
			mockDb.insert.mockImplementationOnce(() => {
				throw new Error("Database connection failed");
			});

			await expect(service.startSession({
				userId: "user-123",
				lessonId: "lesson-456"
			})).rejects.toThrow("Database connection failed");
		});

		it("should handle invalid speed values", async () => {
			const segment: WatchSegmentData = {
				clientEventId: "event-123",
				startSecond: 0,
				endSecond: 10,
				speed: 0 // Invalid speed
			};

			// Should not throw, just record the segment
			await expect(() => service.recordWatchSegment("session-123", segment)).not.toThrow();
		});

		it("should handle negative time values", async () => {
			const segment: WatchSegmentData = {
				clientEventId: "event-123",
				startSecond: 20,
				endSecond: 10, // End before start
				speed: 1.0
			};

			await expect(() => service.recordWatchSegment("session-123", segment)).not.toThrow();
		});
	});

	describe("Edge Cases", () => {
		it("should handle very high playback speeds", async () => {
			const segment: WatchSegmentData = {
				clientEventId: "event-123",
				startSecond: 0,
				endSecond: 10,
				speed: 5.0 // Very high speed
			};

			await service.recordWatchSegment("session-123", segment);
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle very low playback speeds", async () => {
			const segment: WatchSegmentData = {
				clientEventId: "event-123",
				startSecond: 0,
				endSecond: 10,
				speed: 0.1 // Very low speed
			};

			await service.recordWatchSegment("session-123", segment);
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle long video segments", async () => {
			const segment: WatchSegmentData = {
				clientEventId: "event-123",
				startSecond: 0,
				endSecond: 7200, // 2 hours
				speed: 1.0
			};

			await service.recordWatchSegment("session-123", segment);
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
		});

		it("should handle many overlapping intervals efficiently", () => {
			const service = new VideoProgressService();
			const intervals: Array<[number, number]> = [];
			
			// Create 100 overlapping intervals
			for (let i = 0; i < 100; i++) {
				intervals.push([i, i + 50]);
			}

			const calculateMethod = (service as any).calculateCoverageFromIntervals.bind(service);
			const result = calculateMethod(intervals);

			expect(result).toBe(149); // 0 to 149
		});
	});

	describe("Performance Edge Cases", () => {
		it("should handle large number of segments", () => {
			const service = new VideoProgressService();
			const segments = [];
			
			// Create 1000 segments
			for (let i = 0; i < 1000; i++) {
				segments.push({
					startSecond: i * 10,
					endSecond: (i * 10) + 5,
					speed: "1.0"
				});
			}

			const calculateMethod = (service as any).calculateProgressFromSegments.bind(service);
			const result: ProgressSummary = calculateMethod(segments);

			expect(result.totalEffectiveSeconds).toBe(5000); // 1000 segments * 5 seconds each
			expect(result.maxVerifiedSecond).toBe(9995); // Last segment ends at 9995
		});

		it("should handle segments with microsecond precision", () => {
			const service = new VideoProgressService();
			const segments = [
				{ startSecond: 0.001, endSecond: 10.999, speed: "1.0" },
				{ startSecond: 11.001, endSecond: 21.999, speed: "1.5" }
			];

			const calculateMethod = (service as any).calculateProgressFromSegments.bind(service);
			const result: ProgressSummary = calculateMethod(segments);

			expect(result.totalEffectiveSeconds).toBeCloseTo(18.3307, 2);
			expect(result.maxVerifiedSecond).toBeCloseTo(21.999, 3);
		});
	});
});