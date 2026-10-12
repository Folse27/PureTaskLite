import { describe, expect, it } from "vitest";
import { canAddChild, childDepth, DepthLimitError, MAX_DEPTH, subtreeFits } from "./depth";

describe("sub-note depth limit", () => {
  it("allows three levels below a top-level task", () => {
    expect(MAX_DEPTH).toBe(3);
    expect(childDepth(null)).toBe(0);
    expect(childDepth(0)).toBe(1);
    expect(childDepth(1)).toBe(2);
    expect(childDepth(2)).toBe(3);
  });

  it("rejects a fourth level", () => {
    expect(() => childDepth(3)).toThrow(DepthLimitError);
  });

  it("hides the add-sub-note control only at max depth", () => {
    expect([0, 1, 2, 3].map(canAddChild)).toEqual([true, true, true, false]);
  });

  it("checks whether a moved subtree still fits", () => {
    expect(subtreeFits(0, 3)).toBe(true);
    expect(subtreeFits(1, 2)).toBe(true);
    expect(subtreeFits(1, 3)).toBe(false);
    expect(subtreeFits(3, 0)).toBe(true);
    expect(subtreeFits(-1, 0)).toBe(false);
  });
});
