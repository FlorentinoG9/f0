import type { RefObject } from "react"

/**
 * Narrow a nullable ref for third-party hooks that still expect a non-nullable one.
 *
 * React 19 types `useRef<T>(null)` as `RefObject<T | null>`, but several
 * libraries we depend on (`usehooks-ts`, `react-virtuoso`) still declare their
 * ref parameters as `RefObject<T>`. `RefObject` is invariant — `current` is
 * mutable — so the two never unify, no matter which side is widened.
 *
 * The assertion is sound rather than merely convenient: every consumer here
 * guards on `current` before touching the node, which is exactly why the ref
 * is initialised to `null` in the first place. Drop the call once the upstream
 * types are updated for React 19.
 */
export const asNonNullRef = <T>(ref: RefObject<T | null>): RefObject<T> =>
  ref as RefObject<T>
