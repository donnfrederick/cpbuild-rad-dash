import { vi } from "vitest";

export const revalidateTag = vi.fn();
export const revalidatePath = vi.fn();

// Pass-through: calls the underlying function directly without caching.
export const unstable_cache = <T>(fn: () => Promise<T>) => fn;
