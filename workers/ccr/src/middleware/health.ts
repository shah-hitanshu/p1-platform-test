/**
 * Health Check Handler
 *
 * Validates database connectivity and reports system health status.
 * Extracted from index.ts.
 */

import { sql } from 'drizzle-orm';
import { driverErrorCode } from '../db/driver-error';
import { db } from '../db/scope';
import { setGauge, recordTiming } from '../services/metrics-service';
import type { Env } from '../env';

/**
 * Health check response type.
 */
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  environment: string;
  timestamp: string;
  database?: {
    connected: boolean;
    latencyMs?: number;
    error?: string;
  };
}

/**
 * Handle health check endpoint.
 * Validates database connectivity.
 */
export async function handleHealth(env: Env): Promise<Response> {
  const health: HealthResponse = {
    status: 'healthy',
    environment: env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  };

  // Test database connection (connection is already established via runWithConnection)
  try {
    const start = Date.now();
    const rows = await db().execute(sql`SELECT NOW() as now`);
    const latencyMs = Date.now() - start;

    health.database = {
      connected: true,
      latencyMs,
    };

    // Verify we got a result
    if (rows.length === 0) {
      throw new Error('No result from database');
    }

    // Record database health metrics
    setGauge('ccr_db_health_status', 1);
    recordTiming('ccr_db_health_latency_ms', latencyMs);
  } catch (error) {
    health.status = 'unhealthy';
    // A rejected query's message embeds the statement text, which can carry
    // customer content. The SQLSTATE, or the error's name, is what a public
    // probe can report.
    health.database = {
      connected: false,
      error: driverErrorCode(error) ?? (error instanceof Error ? error.name : 'Unknown error'),
    };

    // Record unhealthy database status
    setGauge('ccr_db_health_status', 0);
  }

  // Record worker info gauge
  setGauge('ccr_worker_info', 1, {
    version: env.APP_VERSION ?? 'dev',
    environment: env.ENVIRONMENT,
  });

  return new Response(JSON.stringify(health, null, 2), {
    status: health.status === 'healthy' ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  });
}
