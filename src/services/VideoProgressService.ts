import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/client";
import { 
	watchSession, 
	watchSegment, 
	seekEvent, 
	lessonAttempt
} from "../db/schema";

export interface WatchSegmentData {
	clientEventId: string;
	startSecond: number;
	endSecond: number;
	speed: number;
}

export interface SeekEventData {
	fromSecond: number;
	toSecond: number;
	allowed: boolean;
	reason: string;
}

export interface SessionStartData {
	userId: string;
	lessonId: string;
	lessonAttemptId?: string;
	clientInfo?: any;
}

export interface ProgressSummary {
	totalEffectiveSeconds: number;
	coverageSeconds: number;
	maxVerifiedSecond: number;
	skipEvents: number;
	speedBreakdown: Record<string, number>;
}

export default class VideoProgressService {
	
	async startSession(data: SessionStartData): Promise<string> {
		const [session] = await db.insert(watchSession).values({
			userId: data.userId,
			lessonId: data.lessonId,
			lessonAttemptId: data.lessonAttemptId,
			clientInfo: data.clientInfo,
		}).returning({ id: watchSession.id });

		return session.id;
	}

	async recordWatchSegment(sessionId: string, segment: WatchSegmentData): Promise<void> {
		await db.insert(watchSegment).values({
			sessionId,
			clientEventId: segment.clientEventId,
			startSecond: segment.startSecond,
			endSecond: segment.endSecond,
			speed: segment.speed.toString(),
		}).onConflictDoNothing();
	}

	async recordSeekEvent(sessionId: string, seekData: SeekEventData): Promise<void> {
		const skipDistance = Math.abs(seekData.toSecond - seekData.fromSecond);
		const isSkip = !seekData.allowed && skipDistance > 5; // Consider >5s jumps as skips

		await db.insert(seekEvent).values({
			sessionId,
			fromSecond: seekData.fromSecond,
			toSecond: seekData.toSecond,
			allowed: seekData.allowed,
			reason: seekData.reason,
			isSkip,
			skipDistance,
		});
	}

	async updateSessionHeartbeat(sessionId: string): Promise<void> {
		await db.update(watchSession)
			.set({ lastHeartbeatAt: new Date() })
			.where(eq(watchSession.id, sessionId));
	}

	async closeSession(sessionId: string): Promise<void> {
		await db.update(watchSession)
			.set({ closedAt: new Date() })
			.where(eq(watchSession.id, sessionId));

		// Trigger progress calculation for the session
		await this.calculateSessionProgress(sessionId);
	}

	private async calculateSessionProgress(sessionId: string): Promise<void> {
		// Get session details
		const [session] = await db.select()
			.from(watchSession)
			.where(eq(watchSession.id, sessionId));

		if (!session || !session.lessonAttemptId) return;

		// Get all segments for this session
		const segments = await db.select()
			.from(watchSegment)
			.where(eq(watchSegment.sessionId, sessionId))
			.orderBy(watchSegment.startSecond);

		// Get skip events count
		const [skipCount] = await db.select({
			count: sql<number>`count(*)`
		})
			.from(seekEvent)
			.where(and(
				eq(seekEvent.sessionId, sessionId),
				eq(seekEvent.isSkip, true)
			));

		const progress = this.calculateProgressFromSegments(segments);
		
		// Update lesson attempt with aggregated progress
		await db.update(lessonAttempt)
			.set({
				maxVerifiedSecond: progress.maxVerifiedSecond,
				totalEffectiveSeconds: progress.totalEffectiveSeconds.toString(),
				coverageSeconds: progress.coverageSeconds,
				skipEvents: sql`${lessonAttempt.skipEvents} + ${skipCount.count}`,
				updatedAt: new Date(),
			})
			.where(eq(lessonAttempt.id, session.lessonAttemptId));
	}

	private calculateProgressFromSegments(segments: any[]): ProgressSummary {
		let totalEffectiveSeconds = 0;
		let maxVerifiedSecond = 0;
		const coveredIntervals: Array<[number, number]> = [];
		const speedBreakdown: Record<string, number> = {};

		for (const segment of segments) {
			const duration = segment.endSecond - segment.startSecond;
			const speed = parseFloat(segment.speed);
			const effectiveTime = duration / speed;
			
			totalEffectiveSeconds += effectiveTime;
			maxVerifiedSecond = Math.max(maxVerifiedSecond, segment.endSecond);
			
			// Track coverage intervals
			coveredIntervals.push([segment.startSecond, segment.endSecond]);
			
			// Track speed breakdown
			const speedKey = speed.toString();
			speedBreakdown[speedKey] = (speedBreakdown[speedKey] || 0) + duration;
		}

		// Calculate actual coverage by merging overlapping intervals
		const coverageSeconds = this.calculateCoverageFromIntervals(coveredIntervals);

		return {
			totalEffectiveSeconds,
			coverageSeconds,
			maxVerifiedSecond,
			skipEvents: 0, // Calculated separately
			speedBreakdown,
		};
	}

	private calculateCoverageFromIntervals(intervals: Array<[number, number]>): number {
		if (intervals.length === 0) return 0;
		
		// Sort intervals by start time
		intervals.sort((a, b) => a[0] - b[0]);
		
		let totalCoverage = 0;
		let currentStart = intervals[0][0];
		let currentEnd = intervals[0][1];
		
		for (let i = 1; i < intervals.length; i++) {
			const [start, end] = intervals[i];
			
			if (start <= currentEnd) {
				// Overlapping intervals, merge them
				currentEnd = Math.max(currentEnd, end);
			} else {
				// Non-overlapping, add previous interval and start new one
				totalCoverage += currentEnd - currentStart;
				currentStart = start;
				currentEnd = end;
			}
		}
		
		// Add the last interval
		totalCoverage += currentEnd - currentStart;
		
		return totalCoverage;
	}

	async getLessonProgress(userId: string, lessonId: string): Promise<any> {
		// Get latest attempt for this lesson
		const [attempt] = await db.select()
			.from(lessonAttempt)
			.where(and(
				eq(lessonAttempt.userId, userId),
				eq(lessonAttempt.lessonId, lessonId)
			))
			.orderBy(desc(lessonAttempt.attemptNo))
			.limit(1);

		if (!attempt) return null;

		// Get recent sessions for this attempt
		const sessions = await db.select()
			.from(watchSession)
			.where(eq(watchSession.lessonAttemptId, attempt.id))
			.orderBy(desc(watchSession.startedAt));

		return {
			attempt,
			sessions,
			progress: {
				maxVerifiedSecond: attempt.maxVerifiedSecond,
				totalEffectiveSeconds: parseFloat(attempt.totalEffectiveSeconds),
				coverageSeconds: attempt.coverageSeconds,
				skipEvents: attempt.skipEvents,
				isAssigned: attempt.isAssigned,
			}
		};
	}

	async getOrCreateLessonAttempt(
		userId: string, 
		lessonId: string, 
		isAssigned: boolean = false
	): Promise<string> {
		// Check if there's an active attempt
		const [existingAttempt] = await db.select()
			.from(lessonAttempt)
			.where(and(
				eq(lessonAttempt.userId, userId),
				eq(lessonAttempt.lessonId, lessonId),
				eq(lessonAttempt.status, "InProgress")
			))
			.orderBy(desc(lessonAttempt.attemptNo))
			.limit(1);

		if (existingAttempt) {
			// Update assignment status if it changed
			if (existingAttempt.isAssigned !== isAssigned) {
				await db.update(lessonAttempt)
					.set({ isAssigned })
					.where(eq(lessonAttempt.id, existingAttempt.id));
			}
			return existingAttempt.id;
		}

		// Get next attempt number
		const [maxAttempt] = await db.select({
			maxAttemptNo: sql<number>`coalesce(max(${lessonAttempt.attemptNo}), 0)`
		})
			.from(lessonAttempt)
			.where(and(
				eq(lessonAttempt.userId, userId),
				eq(lessonAttempt.lessonId, lessonId)
			));

		// Create new attempt
		const [newAttempt] = await db.insert(lessonAttempt)
			.values({
				userId,
				lessonId,
				attemptNo: (maxAttempt.maxAttemptNo || 0) + 1,
				isAssigned,
			})
			.returning({ id: lessonAttempt.id });

		return newAttempt.id;
	}

	async markLessonComplete(attemptId: string): Promise<void> {
		await db.update(lessonAttempt)
			.set({ 
				status: "Completed",
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(lessonAttempt.id, attemptId));
	}

	async getUnassignedViewingHistory(userId: string): Promise<any[]> {
		const unassignedAttempts = await db.select()
			.from(lessonAttempt)
			.where(and(
				eq(lessonAttempt.userId, userId),
				eq(lessonAttempt.isAssigned, false)
			))
			.orderBy(desc(lessonAttempt.createdAt));

		return unassignedAttempts;
	}

	async getSkipAnalytics(sessionId: string): Promise<any> {
		const skips = await db.select()
			.from(seekEvent)
			.where(and(
				eq(seekEvent.sessionId, sessionId),
				eq(seekEvent.isSkip, true)
			))
			.orderBy(seekEvent.createdAt);

		return {
			totalSkips: skips.length,
			skippedSegments: skips.map(skip => ({
				from: skip.fromSecond,
				to: skip.toSecond,
				distance: skip.skipDistance,
				timestamp: skip.createdAt,
			})),
		};
	}
}