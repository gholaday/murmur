import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserDto } from "@murmur/shared";
import { SESSION_COOKIE, userFromToken } from "./auth";
import { getContext } from "./context";

/** The signed-in user for server components, from the session cookie. */
export async function currentUser(): Promise<UserDto | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userFromToken(await getContext(), token);
}

/**
 * The signed-in user, or a redirect to sign in. Every page calls this itself: Next renders
 * a page alongside its layout, so the layout's check alone can't stop the page running.
 */
export async function requirePageUser(): Promise<UserDto> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
