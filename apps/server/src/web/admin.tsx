"use client";

import { createContext, useContext } from "react";

/** Who's signed in, as far as menus care: an admin gets Edit and Match, and Match for video needs TMDB. */
const AdminContext = createContext({ isAdmin: false, tmdb: false });

export function AdminProvider({ isAdmin, tmdb, children }: { isAdmin: boolean; tmdb: boolean; children: React.ReactNode }) {
  return <AdminContext.Provider value={{ isAdmin, tmdb }}>{children}</AdminContext.Provider>;
}

export const useAdmin = () => useContext(AdminContext);
