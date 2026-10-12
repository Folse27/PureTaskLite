import "server-only";
import { and, count, eq, gte, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { LoginRateLimiter, type Lock, type RateLimitStore } from "@/lib/auth/rate-limit";

const { loginAttempts, loginLockouts } = schema;

/** Postgres-backed store: serverless instances share no memory. */
class PostgresRateLimitStore implements RateLimitStore {
  private db = getDb();

  async prune(before: Date) {
    await this.db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, before));
    await this.db.delete(loginLockouts).where(lt(loginLockouts.lockedUntil, before));
  }

  async getLock(key: string): Promise<Lock | null> {
    const [row] = await this.db.select().from(loginLockouts).where(eq(loginLockouts.key, key));
    return row ? { lockedUntil: row.lockedUntil, level: row.level } : null;
  }

  async setLock(key: string, lock: Lock) {
    const values = { lockedUntil: lock.lockedUntil, level: lock.level, updatedAt: new Date() };
    await this.db
      .insert(loginLockouts)
      .values({ key, ...values })
      .onConflictDoUpdate({ target: loginLockouts.key, set: values });
  }

  async deleteLock(key: string) {
    await this.db.delete(loginLockouts).where(eq(loginLockouts.key, key));
  }

  async recordFailure(ipHash: string, at: Date) {
    await this.db.insert(loginAttempts).values({ ipHash, attemptedAt: at });
  }

  async countFailures(since: Date, ipHash?: string) {
    const filter = ipHash
      ? and(eq(loginAttempts.ipHash, ipHash), gte(loginAttempts.attemptedAt, since))
      : gte(loginAttempts.attemptedAt, since);
    const [row] = await this.db.select({ value: count() }).from(loginAttempts).where(filter);
    return row.value;
  }

  async clearFailures(ipHash: string) {
    await this.db.delete(loginAttempts).where(eq(loginAttempts.ipHash, ipHash));
  }
}

export function loginRateLimiter() {
  return new LoginRateLimiter(new PostgresRateLimitStore());
}
