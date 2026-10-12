/**
 * Spring presets (Apple's damping/response model expressed as Motion's
 * bounce/duration). Critically damped by default; a little bounce only after
 * a gesture that carried momentum (a sheet flicked by the user).
 */
export const SPRING = { type: "spring", bounce: 0, duration: 0.35 } as const;
export const SPRING_FAST = { type: "spring", bounce: 0, duration: 0.25 } as const;
export const SPRING_MOMENTUM = { type: "spring", bounce: 0.15, duration: 0.4 } as const;

/** Apple's momentum projection: where a flick would come to rest (px). */
export function project(velocityPxPerSecond: number, decelerationRate = 0.998): number {
  return ((velocityPxPerSecond / 1000) * decelerationRate) / (1 - decelerationRate);
}
