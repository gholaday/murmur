"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * What's typed in Search, shared by the box in the bottom bar (phones) and the one on the
 * page (wide screens). It lives in the shell so the bar's box survives moving to /search,
 * which is what lets it grow out of the Search tab instead of appearing.
 */
interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  /** Goes up each time the search is submitted with Enter, so the page can remember it. */
  submits: number;
  submit: () => void;
}

const SearchContext = createContext<SearchState | null>(null);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [submits, setSubmits] = useState(0);
  const submit = useCallback(() => setSubmits((n) => n + 1), []);
  const value = useMemo(() => ({ query, setQuery, submits, submit }), [query, submits, submit]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearchState(): SearchState {
  const state = useContext(SearchContext);
  if (!state) throw new Error("useSearchState needs SearchProvider");
  return state;
}
