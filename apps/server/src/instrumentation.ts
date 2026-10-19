/** Starts the database, scanner and watcher as soon as the server boots, not on the first request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { getContext } = await import("./server/context");
  await getContext().catch(() => {
    // already logged; in production the process exits and Docker restarts it
  });
}
