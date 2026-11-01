import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// From 1.0 the API only grows (docs/spec/versions.md). This lists every route and its methods, so
// removing or renaming one fails here until api-routes.snapshot.txt changes on purpose, which is
// when to ask whether it's a major version. A new route just adds a line:
// pnpm --filter @murmur/server exec vitest run src/server/api-routes -u

const API = path.join(import.meta.dirname, "../app/api");
const METHOD = /export\s+(?:const|(?:async\s+)?function)\s+(GET|HEAD|POST|PUT|PATCH|DELETE)\b/g;

function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return routes(full);
    if (e.name !== "route.ts") return [];
    const methods = [...fs.readFileSync(full, "utf8").matchAll(METHOD)].map((m) => m[1]).sort();
    return [`/api${path.relative(API, dir).split(path.sep).join("/").replace(/^(?=.)/, "/")} ${methods.join(" ")}`];
  });
}

it("keeps every API route and method", async () => {
  await expect(routes(API).sort().join("\n") + "\n").toMatchFileSnapshot("./api-routes.snapshot.txt");
});
