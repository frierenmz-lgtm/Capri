import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_CHARS, attachmentKind, documentText, imagePath, ownsImagePath } from "@/lib/images";

describe("image paths", () => {
  it("reads our scheme only", () => {
    expect(imagePath("capri-image://u1/a.png")).toBe("u1/a.png");
    expect(imagePath("https://x/a.png")).toBeNull();
  });
  it("only the owner can use a path", () => {
    expect(ownsImagePath("u1/a.png", "u1")).toBe(true);
    expect(ownsImagePath("u2/a.png", "u1")).toBe(false);
    expect(ownsImagePath("u1/../u2/a.png", "u1")).toBe(false);
  });
});

describe("attachment kinds", () => {
  it("accepts images, PDFs, TXT, CSV and code files", () => {
    expect(attachmentKind("image/png", "a.png")).toBe("image");
    expect(attachmentKind("application/pdf", "doc.pdf")).toBe("pdf");
    expect(attachmentKind("text/plain", "notas.txt")).toBe("text");
    expect(attachmentKind("text/csv", "datos.csv")).toBe("text");
    expect(attachmentKind("", "script.py")).toBe("text");
    // .ts files often arrive as a video type; the extension wins
    expect(attachmentKind("video/mp2t", "app.ts")).toBe("text");
  });
  it("rejects files Capri can't read", () => {
    expect(attachmentKind("application/zip", "a.zip")).toBeNull();
    expect(attachmentKind("video/mp4", "clip.mp4")).toBeNull();
  });
  it("cuts long documents and says so", () => {
    const out = documentText("big.txt", "x".repeat(MAX_DOCUMENT_CHARS + 10));
    expect(out).toContain("big.txt");
    expect(out).toContain("solo se incluyen");
    expect(documentText("small.txt", "hola")).not.toContain("solo se incluyen");
  });
});
