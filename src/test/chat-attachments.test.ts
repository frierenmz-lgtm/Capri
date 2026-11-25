import { describe, expect, it, vi } from "vitest";
import { uploadBatchWithCleanup, validateChatAttachments } from "@/lib/chat-attachments";

function fakeFile(name: string, type: string, size = 10): File {
  return { name, type, size } as File;
}

describe("validateChatAttachments", () => {
  it("reports every rejected category while retaining files that fit", () => {
    const files = [
      fakeFile("ok.png", "image/png"),
      fakeFile("large.png", "image/png", 20),
      fakeFile("bad.exe", "application/octet-stream"),
      fakeFile("extra.png", "image/png"),
    ];

    const result = validateChatAttachments(files, {
      accept: "image/*,application/pdf,text/*,.txt",
      currentCount: 3,
      maxFiles: 4,
      maxFileSize: 15,
    });

    expect(result.accepted.map((file) => file.name)).toEqual(["ok.png"]);
    expect(result.issue?.code).toBe("rejected");
    expect(result.issue?.message).toContain("bad.exe");
    expect(result.issue?.message).toContain("large.png");
    expect(result.issue?.message).toContain("extra.png");
  });
});

describe("uploadBatchWithCleanup", () => {
  it("returns uploaded values and does not clean up when every upload succeeds", async () => {
    const removeUploaded = vi.fn(async () => {});

    const result = await uploadBatchWithCleanup(
      ["a", "b"],
      async (name) => ({ path: `user/${name}`, value: name.toUpperCase() }),
      removeUploaded,
    );

    expect(result).toEqual(["A", "B"]);
    expect(removeUploaded).not.toHaveBeenCalled();
  });

  it("waits for all uploads and removes successful siblings after a partial failure", async () => {
    const removeUploaded = vi.fn(async (_paths: string[]) => {});
    const uploadOne = vi.fn(async (name: string) => {
      if (name === "bad") throw new Error("No se pudo subir «bad.png».");
      await Promise.resolve();
      return { path: `user/${name}`, value: name };
    });

    await expect(
      uploadBatchWithCleanup(["good", "bad"], uploadOne, removeUploaded),
    ).rejects.toThrow("No se pudo subir «bad.png».");
    expect(uploadOne).toHaveBeenCalledTimes(2);
    expect(removeUploaded).toHaveBeenCalledWith(["user/good"]);
  });

  it("reports when cleanup of successful partial uploads also fails", async () => {
    const removeUploaded = vi.fn(async () => {
      throw new Error("Storage no disponible.");
    });

    await expect(
      uploadBatchWithCleanup(
        ["good", "bad"],
        async (name) => {
          if (name === "bad") throw new Error("Falló bad.png.");
          return { path: "user/good", value: name };
        },
        removeUploaded,
      ),
    ).rejects.toThrow(
      "Falló bad.png. Además, no se pudieron limpiar las cargas parciales: Storage no disponible.",
    );
  });
});
