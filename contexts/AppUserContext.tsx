"use client";

import { createContext, useContext } from "react";
import type { MeUser } from "@/hooks/useMe";

const AppUserContext = createContext<MeUser | null>(null);

export function AppUserProvider({
  user,
  children,
}: {
  user: MeUser;
  children: React.ReactNode;
}): React.ReactElement {
  return <AppUserContext.Provider value={user}>{children}</AppUserContext.Provider>;
}

/** Returns the authenticated user. Only callable inside an `(app)` route — layout guarantees auth. */
export function useAppUser(): MeUser {
  const user = useContext(AppUserContext);
  if (!user) throw new Error("useAppUser must be used within AppUserProvider (inside the (app) route group)");
  return user;
}
