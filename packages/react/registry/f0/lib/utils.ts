import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Merge conditional class names, resolving conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The F0 focus ring. Apply to any custom interactive element so keyboard focus
 * looks identical to focus on a real F0 component.
 */
export function focusRing(extraClasses?: string) {
  return cn(
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-f1-special-ring focus-visible:ring-offset-1",
    extraClasses
  )
}
