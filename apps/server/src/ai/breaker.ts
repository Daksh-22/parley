import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Circuit breaker on provider error spikes. Per instance and in memory by
// design: a provider outage hits every instance within seconds anyway, and
// instance-local state means no extra Redis traffic on the hot path.

let failureTimes: number[] = [];
let openUntil = 0;

export function breakerOpen(): boolean {
  return Date.now() < openUntil;
}

export function recordProviderFailure(): void {
  const now = Date.now();
  failureTimes = failureTimes.filter((t) => now - t < env.AI_BREAKER_WINDOW_MS);
  failureTimes.push(now);
  if (failureTimes.length >= env.AI_BREAKER_THRESHOLD && !breakerOpen()) {
    openUntil = now + env.AI_BREAKER_COOLDOWN_MS;
    failureTimes = [];
    logger.warn({ cooldownMs: env.AI_BREAKER_COOLDOWN_MS }, 'ai circuit breaker opened');
  }
}

export function recordProviderSuccess(): void {
  failureTimes = [];
}

/** Test hook. */
export function resetBreaker(): void {
  failureTimes = [];
  openUntil = 0;
}
