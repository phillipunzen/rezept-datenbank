import test, { mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { fetchPublic } from "../server/lib/safe-fetch";

test("remote fetch pins validated DNS, rechecks redirects and bounds decompressed bodies", async () => {
  let addresses = [{ address: "93.184.216.34", family: 4 }];
  let lookups = 0;
  mock.method(dns, "lookup", async () => {
    lookups++;
    return addresses;
  });
  let requested = 0;
  let status = 200;
  let headers: Record<string, string> = { "content-type": "text/html" };
  let body = Buffer.from("recipe");
  const pin: string[] = [];
  mock.method(
    http,
    "request",
    (_url: URL, options: any, callback: (response: any) => void) => {
      requested++;
      options.lookup(
        "public.example.test",
        {},
        (error: Error | null, address: string) => {
          assert.equal(error, null);
          pin.push(address);
        },
      );
      const request = new EventEmitter() as any;
      request.setTimeout = () => request;
      request.destroy = (error?: Error) => {
        if (error) request.emit("error", error);
      };
      request.end = () =>
        queueMicrotask(() => {
          const response = Readable.from([body]) as any;
          response.statusCode = status;
          response.headers = headers;
          callback(response);
        });
      return request;
    },
  );
  try {
    const signal = AbortSignal.timeout(2000);
    const result = await fetchPublic(
      "http://public.example.test/recipe",
      1024,
      signal,
    );
    assert.equal(result.body.toString(), "recipe");
    assert.deepEqual(pin, ["93.184.216.34"]);
    assert.equal(
      lookups,
      1,
      "No unvalidated second DNS resolution for the socket",
    );
    addresses = [{ address: "127.0.0.1", family: 4 }];
    await assert.rejects(
      fetchPublic("http://public.example.test/recipe", 1024, signal),
      /interne Netzwerkadressen/,
    );
    assert.equal(requested, 1);
    addresses = [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ];
    await assert.rejects(
      fetchPublic("http://public.example.test/recipe", 1024, signal),
      /interne Netzwerkadressen/,
    );
    assert.equal(requested, 1);
    addresses = [{ address: "93.184.216.34", family: 4 }];
    status = 302;
    headers = { location: "http://169.254.169.254/metadata" };
    await assert.rejects(
      fetchPublic("http://public.example.test/redirect", 1024, signal),
      /interne Netzwerkadressen/,
    );
    assert.equal(
      requested,
      2,
      "Private redirect was rejected before a second request",
    );
    status = 200;
    headers = { "content-type": "text/html", "content-encoding": "gzip" };
    body = gzipSync(Buffer.alloc(4096));
    await assert.rejects(
      fetchPublic("http://public.example.test/compressed", 1024, signal),
      /zu groß/,
    );
  } finally {
    mock.restoreAll();
  }
});
