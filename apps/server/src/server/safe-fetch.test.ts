import { describe, expect, it } from "vitest";
import { assertPublicHost } from "./safe-fetch";

const refused = (url: string) => expect(assertPublicHost(new URL(url))).rejects.toThrow();

describe("assertPublicHost", () => {
  it("refuses the server itself, by name or address, in both IP versions", async () => {
    await refused("http://localhost:3000/api/health");
    await refused("http://127.0.0.1:3000/");
    await refused("http://[::1]:3000/");
    await refused("http://[::ffff:127.0.0.1]/");
    await refused("http://169.254.169.254/latest/meta-data/");
    await refused("http://0.0.0.0/");
  });

  it("refuses private addresses by default, and anything that isn't http(s)", async () => {
    await refused("http://192.168.1.20/feed.xml");
    await refused("http://10.0.0.5/");
    await refused("http://172.18.0.3:3001/health");
    await refused("ftp://example.com/");
    await refused("file:///etc/passwd");
  });

  it("lets a public address through", async () => {
    await expect(assertPublicHost(new URL("https://93.184.216.34/"))).resolves.toBeUndefined();
  });
});
