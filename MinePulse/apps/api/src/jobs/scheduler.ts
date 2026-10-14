import { runAggregation } from './aggregationJob.js';
import { runRetention } from './retentionJob.js';
import { logger } from '../utils/logger.js';

/** Background job cadences. */
const AGGREGATION_INTERVAL_MS = 60_000; // roll up every minute
const RETENTION_INTERVAL_MS = 6 * 3_600_000; // sweep retention every 6 hours
const WARMUP_MS = 10_000;

/**
 * Start the background jobs and return a stop function. Jobs are idempotent, so
 * a crash/restart simply re-runs the most recent window.
 */
export function startJobs(): () => void {
  const runAgg = (): void => {
    void runAggregation().catch((error) => logger.warn({ err: error }, 'Aggregation job failed'));
  };
  const runRet = (): void => {
    void runRetention().catch((error) => logger.warn({ err: error }, 'Retention job failed'));
  };

  const warmup = setTimeout(() => {
    runAgg();
    runRet();
  }, WARMUP_MS);
  const aggregation = setInterval(runAgg, AGGREGATION_INTERVAL_MS);
  const retention = setInterval(runRet, RETENTION_INTERVAL_MS);

  for (const timer of [warmup, aggregation, retention]) {
    timer.unref?.();
  }

  logger.info(
    { aggregationMs: AGGREGATION_INTERVAL_MS, retentionMs: RETENTION_INTERVAL_MS },
    'Background jobs scheduled',
  );

  return () => {
    clearTimeout(warmup);
    clearInterval(aggregation);
    clearInterval(retention);
  };
}
