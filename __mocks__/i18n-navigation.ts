import { vi } from "vitest";

export const getPathname = vi.fn().mockReturnValue("/");
export const Link = vi.fn();
export const redirect = vi.fn();
export const usePathname = vi.fn().mockReturnValue("/");
export const useRouter = vi.fn().mockReturnValue({ push: vi.fn(), replace: vi.fn(), back: vi.fn() });
