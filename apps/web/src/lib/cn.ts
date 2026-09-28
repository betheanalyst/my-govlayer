import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Conditional class names with Tailwind conflict resolution.
 * The only class-composition helper in the app (Foundation Standard
 * section 6, `lib/`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
