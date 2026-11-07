import crypto from "node:crypto";

/** A new random id for a row: 12 URL-safe characters. */
export const newId = () => crypto.randomBytes(9).toString("base64url");
