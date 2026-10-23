import { beforeEach, describe, expect, it } from "vitest";
import { formatWait, lockoutDurationMs, LoginRateLimiter, MemoryRateLimitStore, RATE_LIMIT } from "./rate-limit";

const MIN = 60_000;
const HOUR = 60 * MIN;

let clock: number;
let store: MemoryRateLimitStore;
let limiter: LoginRateLimiter;

const advance = (ms: number) => {
  clock += ms;
};

async function fail(ip: string) {
  const check = await limiter.check(ip);
  if (check.limited) return check;
  return limiter.registerFailure(ip);
}

async function failTimes(ip: string, n: number) {
  let last;
  for (let i = 0; i < n; i++) last = await fail(ip);
  return last!;
}

beforeEach(() => {
  clock = Date.parse("2026-10-12T10:00:00Z");
  store = new MemoryRateLimitStore();
  limiter = new LoginRateLimiter(store, () => new Date(clock));
});

describe("lockoutDurationMs", () => {
  it("backs off exponentially and caps at 24 h", () => {
    expect(lockoutDurationMs(1)).toBe(15 * MIN);
    expect(lockoutDurationMs(2)).toBe(30 * MIN);
    expect(lockoutDurationMs(3)).toBe(HOUR);
    expect(lockoutDurationMs(4)).toBe(2 * HOUR);
    expect(lockoutDurationMs(7)).toBe(16 * HOUR);
    expect(lockoutDurationMs(8)).toBe(24 * HOUR);
    expect(lockoutDurationMs(30)).toBe(24 * HOUR);
  });
});

describe("per-IP limit", () => {
  it("allows 4 failures, locks on the 5th within 15 minutes", async () => {
    for (let i = 0; i < 4; i++) {
      expect((await fail("a")).limited).toBe(false);
      advance(MIN);
    }
    const fifth = await fail("a");
    expect(fifth).toEqual({ limited: true, scope: "ip", retryAfterSeconds: 15 * 60 });
    const sixth = await limiter.check("a");
    expect(sixth.limited).toBe(true);
  });

  it("does not lock when failures are spread beyond the 15 minute window", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await fail("a")).limited).toBe(false);
      advance(4 * MIN);
    }
  });

  it("only affects the offending IP", async () => {
    await failTimes("a", 5);
    expect((await limiter.check("a")).limited).toBe(true);
    expect((await limiter.check("b")).limited).toBe(false);
  });

  it("reports the remaining wait time", async () => {
    await failTimes("a", 5);
    advance(10 * MIN);
    expect(await limiter.check("a")).toEqual({ limited: true, scope: "ip", retryAfterSeconds: 5 * 60 });
  });

  it("escalates repeated lockouts: 15 min, 30 min, 1 h, capped at 24 h", async () => {
    const expected = [15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 16 * HOUR, 24 * HOUR, 24 * HOUR];
    for (const duration of expected) {
      const result = await failTimes("a", 5);
      expect(result).toMatchObject({ limited: true, retryAfterSeconds: duration / 1000 });
      advance(duration - 1000);
      expect((await limiter.check("a")).limited).toBe(true);
      advance(1000);
      expect((await limiter.check("a")).limited).toBe(false);
    }
  });

  it("needs 5 fresh failures after a lockout ends (old ones don't count)", async () => {
    await failTimes("a", 5);
    advance(15 * MIN);
    for (let i = 0; i < 4; i++) expect((await fail("a")).limited).toBe(false);
    expect((await fail("a")).limited).toBe(true);
  });

  it("resets the counter and backoff level on success", async () => {
    await failTimes("a", 4);
    await limiter.registerSuccess("a");
    // Four more failures are fine again: the earlier four were cleared.
    for (let i = 0; i < 4; i++) expect((await fail("a")).limited).toBe(false);

    // Climb to level 2, then succeed: next lockout starts at 15 min again.
    await fail("a"); // 5th → 15 min
    advance(15 * MIN);
    const second = await failTimes("a", 5);
    expect(second).toMatchObject({ retryAfterSeconds: 30 * 60 });
    advance(30 * MIN);
    await limiter.registerSuccess("a");
    const afterSuccess = await failTimes("a", 5);
    expect(afterSuccess).toMatchObject({ retryAfterSeconds: 15 * 60 });
  });

  it("resets the backoff level after a quiet day", async () => {
    await failTimes("a", 5);
    advance(15 * MIN);
    await failTimes("a", 5); // level 2
    advance(30 * MIN + RATE_LIMIT.levelResetMs);
    expect(await failTimes("a", 5)).toMatchObject({ retryAfterSeconds: 15 * 60 });
  });
});

describe("global limit", () => {
  it("locks everyone for 15 minutes after more than 50 failures in an hour", async () => {
    // 51 failures from 51 different IPs (each stays under the per-IP limit)
    for (let i = 0; i < 50; i++) {
      expect((await fail(`ip${i}`)).limited).toBe(false);
      advance(MIN / 2);
    }
    const tripping = await fail("ip50");
    expect(tripping).toEqual({ limited: true, scope: "global", retryAfterSeconds: 15 * 60 });
    expect(await limiter.check("brand-new-ip")).toEqual({
      limited: true,
      scope: "global",
      retryAfterSeconds: 15 * 60,
    });
    advance(15 * MIN);
    expect((await limiter.check("brand-new-ip")).limited).toBe(false);
    // Failures from before the lock don't immediately re-trigger it.
    expect((await fail("brand-new-ip")).limited).toBe(false);
  });

  it("does not trigger when failures are spread over more than an hour", async () => {
    for (let i = 0; i < 80; i++) {
      expect((await fail(`ip${i}`)).limited).toBe(false);
      advance(2 * MIN);
    }
  });
});

describe("pruning", () => {
  it("removes attempts older than 24 h on each check", async () => {
    await failTimes("a", 3);
    advance(RATE_LIMIT.retentionMs + 1);
    await limiter.check("b");
    expect(store.failures).toHaveLength(0);
  });
});

describe("formatWait", () => {
  it("formats durations", () => {
    expect(formatWait(30)).toBe("30 s");
    expect(formatWait(14 * 60 + 1)).toBe("15 min");
    expect(formatWait(3600)).toBe("1 h");
    expect(formatWait(3900)).toBe("1 h 5 min");
  });
});
