import { describe, expect, it } from "vitest";
import { readBoundedBody } from "@/lib/bounded-body";

function chunkedRequest(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request("https://capri.test/api", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
}

describe("bounded request body", () => {
  it("reads chunked bodies within the byte limit", async () => {
    const result = await readBoundedBody(chunkedRequest(["Cap", "ri"]), 5);
    expect(result && new TextDecoder().decode(result)).toBe("Capri");
  });

  it("rejects chunked bodies that exceed the limit", async () => {
    expect(await readBoundedBody(chunkedRequest(["Cap", "ri!"]), 5)).toBeNull();
  });

  it("rejects oversized declared content lengths before reading", async () => {
    const request = new Request("https://capri.test/api", {
      method: "POST",
      headers: { "content-length": "20" },
      body: "x",
    });
    expect(await readBoundedBody(request, 5)).toBeNull();
  });
});
