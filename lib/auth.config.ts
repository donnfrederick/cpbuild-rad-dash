import type { NextAuthConfig } from "next-auth";

function secureCookiesFromAuthUrl(): boolean {
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  return base.startsWith("https://");
}

/**
 * Edge-safe Auth.js config shared by proxy (middleware) and the full server auth module.
 * No database adapter or credential authorize logic — those live in lib/auth.ts only.
 */
export const authConfig = {
  providers: [],
  secret: process.env.AUTH_SECRET,
  useSecureCookies: secureCookiesFromAuthUrl(),
  trustHost: process.env.AUTH_TRUST_HOST === "true",
  session: { strategy: "jwt" },
  pages: {
    signIn: "/en/login",
    error: "/en/login",
  },
  callbacks: {
    jwt({ token, user, trigger, session: updateSession }) {
      if (user) {
        token["id"] = user.id as string;
        token["role"] = user.role;
        token["email"] = user.email;
        token["name"] = user.name ?? null;
      }
      if (trigger === "update" && updateSession && typeof updateSession === "object") {
        const next = updateSession as { name?: string | null };
        if ("name" in next) {
          token["name"] = next.name ?? null;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (!session?.user) return session;
      const id = token["id"];
      const role = token["role"];
      if (typeof id !== "string" || typeof role !== "string") return session;
      session.user.id = id;
      session.user.role = role;
      const email = token["email"];
      if (typeof email === "string") {
        session.user.email = email;
      }
      const name = token["name"];
      session.user.name =
        typeof name === "string" || name === null ? name : session.user.name;
      return session;
    },
  },
} satisfies NextAuthConfig;
