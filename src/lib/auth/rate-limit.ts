/**
 * Login rate limiting. The policy lives here, independent of storage, so it can
 * be unit-tested with an in-memory store; production uses the Postgres store.
 *
 * - Per IP: 5 failed attempts within 15 minutes lock that IP out. Repeated
 *   lockouts back off exponentially: 15 min, 30 min, 1 h, 2 h … capped at 24 h.
 *   The backoff level resets after a successful login, or once a full day has
 *   passed since the previous lockout ended.
 * - Global: more than 50 failed attempts across all IPs within 1 hour lock the
 *   login for everyone for 15 minutes.
 * - Attempts older than 24 h are pruned opportunistically.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RATE_LIMIT = {
  ipMaxFailures: 5,
  ipWindowMs: 15 * MINUTE,
  ipBaseLockoutMs: 15 * MINUTE,
  ipMaxLockoutMs: 24 * HOUR,
  /** Locking kicks in when failures exceed this number. */
  globalMaxFailures: 50,
  globalWindowMs: HOUR,
  globalLockoutMs: 15 * MINUTE,
  retentionMs: 24 * HOUR,
  levelResetMs: 24 * HOUR,
} as const;

export const GLOBAL_KEY = "global";
export const ipKey = (ipHash: string) => `ip:${ipHash}`;

export interface Lock {
  lockedUntil: Date;
  /** How many consecutive lockouts produced this one (1 = first). */
  level: number;
}

export interface RateLimitStore {
  prune(before: Date): Promise<void>;
  getLock(key: string): Promise<Lock | null>;
  setLock(key: string, lock: Lock): Promise<void>;
  deleteLock(key: string): Promise<void>;
  recordFailure(ipHash: string, at: Date): Promise<void>;
  /** Failures at or after `since`, for one IP or — without `ipHash` — all IPs. */
  countFailures(since: Date, ipHash?: string): Promise<number>;
  clearFailures(ipHash: string): Promise<void>;
}

export type LimitResult = { limited: false } | { limited: true; scope: "ip" | "global"; retryAfterSeconds: number };

export function lockoutDurationMs(level: number): number {
  const exponent = Math.max(0, level - 1);
  return Math.min(RATE_LIMIT.ipBaseLockoutMs * 2 ** exponent, RATE_LIMIT.ipMaxLockoutMs);
}

function retryAfter(lock: Lock, now: Date): number {
  return Math.max(1, Math.ceil((lock.lockedUntil.getTime() - now.getTime()) / 1000));
}

function laterOf(a: Date, b: Date | undefined): Date {
  return b && b > a ? b : a;
}

export class LoginRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Call before checking the password. Also prunes old rows. */
  async check(ipHash: string): Promise<LimitResult> {
    const now = this.now();
    await this.store.prune(new Date(now.getTime() - RATE_LIMIT.retentionMs));

    const global = await this.store.getLock(GLOBAL_KEY);
    if (global && global.lockedUntil > now) {
      return { limited: true, scope: "global", retryAfterSeconds: retryAfter(global, now) };
    }
    const ip = await this.store.getLock(ipKey(ipHash));
    if (ip && ip.lockedUntil > now) {
      return { limited: true, scope: "ip", retryAfterSeconds: retryAfter(ip, now) };
    }
    return { limited: false };
  }

  /** Record a wrong password. Returns a lock if this attempt triggered one. */
  async registerFailure(ipHash: string): Promise<LimitResult> {
    const now = this.now();
    await this.store.recordFailure(ipHash, now);

    // Per-IP: only count failures since the previous lockout ended, so the
    // attempts that caused it don't immediately re-trigger another.
    const previous = await this.store.getLock(ipKey(ipHash));
    const ipSince = laterOf(new Date(now.getTime() - RATE_LIMIT.ipWindowMs), previous?.lockedUntil);
    const ipFailures = await this.store.countFailures(ipSince, ipHash);

    let result: LimitResult = { limited: false };

    if (ipFailures >= RATE_LIMIT.ipMaxFailures) {
      const escalate = previous != null && now.getTime() - previous.lockedUntil.getTime() < RATE_LIMIT.levelResetMs;
      const level = escalate ? previous.level + 1 : 1;
      const lock = { lockedUntil: new Date(now.getTime() + lockoutDurationMs(level)), level };
      await this.store.setLock(ipKey(ipHash), lock);
      result = { limited: true, scope: "ip", retryAfterSeconds: retryAfter(lock, now) };
    }

    const global = await this.store.getLock(GLOBAL_KEY);
    const globalSince = laterOf(new Date(now.getTime() - RATE_LIMIT.globalWindowMs), global?.lockedUntil);
    const totalFailures = await this.store.countFailures(globalSince);

    if (totalFailures > RATE_LIMIT.globalMaxFailures) {
      const lock = {
        lockedUntil: new Date(now.getTime() + RATE_LIMIT.globalLockoutMs),
        level: (global?.level ?? 0) + 1,
      };
      await this.store.setLock(GLOBAL_KEY, lock);
      const seconds = retryAfter(lock, now);
      if (!result.limited || seconds > result.retryAfterSeconds) {
        result = { limited: true, scope: "global", retryAfterSeconds: seconds };
      }
    }

    return result;
  }

  /** A correct password resets this IP's counter and backoff level. */
  async registerSuccess(ipHash: string): Promise<void> {
    await this.store.clearFailures(ipHash);
    await this.store.deleteLock(ipKey(ipHash));
  }
}

/** Simple in-memory store; used by tests and handy for local experiments. */
export class MemoryRateLimitStore implements RateLimitStore {
  failures: { ipHash: string; at: Date }[] = [];
  locks = new Map<string, Lock>();

  async prune(before: Date) {
    this.failures = this.failures.filter((f) => f.at >= before);
    for (const [key, lock] of this.locks) {
      if (lock.lockedUntil < before) this.locks.delete(key);
    }
  }
  async getLock(key: string) {
    return this.locks.get(key) ?? null;
  }
  async setLock(key: string, lock: Lock) {
    this.locks.set(key, lock);
  }
  async deleteLock(key: string) {
    this.locks.delete(key);
  }
  async recordFailure(ipHash: string, at: Date) {
    this.failures.push({ ipHash, at });
  }
  async countFailures(since: Date, ipHash?: string) {
    return this.failures.filter((f) => f.at >= since && (ipHash == null || f.ipHash === ipHash)).length;
  }
  async clearFailures(ipHash: string) {
    this.failures = this.failures.filter((f) => f.ipHash !== ipHash);
  }
}

/** "14 min", "1 h 5 min", "45 s" — used for the friendly lockout message. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
