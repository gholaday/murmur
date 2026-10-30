import { createLogger, errorMessage } from "./log";

const log = createLogger("shelves");

/**
 * Builds one shelf. A shelf that fails is logged and comes back empty, so it hides and the rest
 * of the page still loads.
 */
export async function shelf<T>(name: string, build: () => T | Promise<T>, empty: T): Promise<T> {
  try {
    return await build();
  } catch (err) {
    log.warn("shelf couldn't be built", { shelf: name, error: errorMessage(err) });
    return empty;
  }
}
