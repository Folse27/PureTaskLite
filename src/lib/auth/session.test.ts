import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

const SECRET = "a".repeat(48);

describe("session tokens", () => {
  it("round-trips a valid token", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rejects tokens signed with another secret", async () => {
    const token = await createSessionToken("b".repeat(48));
    expect(await verifySessionToken(token, SECRET)).toBe(false);
  });

  it("rejects tampered expiry", async () => {
    const token = await createSessionToken(SECRET, Date.now(), 60);
    const [v, , sig] = token.split(".");
    const forged = `${v}.${Math.floor(Date.now() / 1000) + 10_000_000}.${sig}`;
    expect(await verifySessionToken(forged, SECRET)).toBe(false);
  });

  it("rejects expired tokens", async () => {
    const issued = Date.now() - 120_000;
    const token = await createSessionToken(SECRET, issued, 60);
    expect(await verifySessionToken(token, SECRET)).toBe(false);
  });

  it("rejects garbage", async () => {
    for (const t of ["", "v1", "v1.123", "v1.abc.def", "v2.1.x", "v1.99999999999.!!!", null, undefined]) {
      expect(await verifySessionToken(t, SECRET)).toBe(false);
    }
  });
});
