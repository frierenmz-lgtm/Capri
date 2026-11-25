import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => {
  const getUser = vi.fn();
  const storageFrom = vi.fn();
  const upload = vi.fn();
  const remove = vi.fn();
  const from = vi.fn();
  const insert = vi.fn();
  return {
    auth: { getUser },
    from,
    getUser,
    insert,
    remove,
    storage: { from: storageFrom },
    storageFrom,
    upload,
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import { buildSystemPrompt } from "@/lib/instructions";
import {
  budgetProjectTexts,
  pickFallbackInstructions,
  projectFileText,
  selectProjectFiles,
} from "@/lib/project-context";
import { MAX_IMAGE_BYTES } from "@/lib/images";
import { uploadProjectFile, uploadProjectFiles, validateProjectFileUploads } from "@/lib/projects";

const file = (name: string, created_at: string) => ({ name, created_at });
const uploadFile = (name: string, type = "text/plain") => new File(["hola"], name, { type });

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  supabaseMock.storageFrom.mockReturnValue({
    upload: supabaseMock.upload,
    remove: supabaseMock.remove,
  });
  supabaseMock.from.mockReturnValue({ insert: supabaseMock.insert });
  supabaseMock.upload.mockResolvedValue({ error: null });
  supabaseMock.insert.mockResolvedValue({ error: null });
  supabaseMock.remove.mockResolvedValue({ error: null });
});

describe("project files in context", () => {
  it("keeps the most recent files, at most 4", () => {
    const files = [
      file("a.txt", "2026-01-01T00:00:00Z"),
      file("b.txt", "2026-01-02T00:00:00Z"),
      file("c.txt", "2026-01-03T00:00:00Z"),
      file("d.txt", "2026-01-04T00:00:00Z"),
      file("e.txt", "2026-01-05T00:00:00Z"),
    ];
    expect(selectProjectFiles(files).map((f) => f.name)).toEqual([
      "e.txt",
      "d.txt",
      "c.txt",
      "b.txt",
    ]);
  });

  it("shares the text budget across files and cuts the rest", () => {
    const out = budgetProjectTexts(
      [
        { name: "a.txt", text: "x".repeat(100) },
        { name: "b.txt", text: "y".repeat(100) },
      ],
      150,
    );
    expect(out[0]).toEqual({ name: "a.txt", text: "x".repeat(100), cut: false });
    expect(out[1]).toEqual({ name: "b.txt", text: "y".repeat(50), cut: true });
  });

  it("drops files once the budget is spent", () => {
    const out = budgetProjectTexts(
      [
        { name: "a.txt", text: "x".repeat(10) },
        { name: "b.txt", text: "y".repeat(10) },
      ],
      10,
    );
    expect(out[1]).toEqual({ name: "b.txt", text: "", cut: true });
  });

  it("formats a project file as an attached document", () => {
    expect(projectFileText("apuntes.txt", "hola")).toContain("Archivo adjunto: apuntes.txt");
  });
});

describe("project file uploads", () => {
  it("accepts at most four compatible files up to 5 MiB each and reports skipped files", () => {
    const oversized = { name: "grande.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 } as File;
    const selection = [
      uploadFile("uno.txt"),
      oversized,
      uploadFile("dos.txt"),
      uploadFile("tres.txt"),
      uploadFile("cuatro.txt"),
      uploadFile("cinco.txt"),
      { name: "app.exe", type: "application/octet-stream", size: 20 } as File,
    ];

    const result = validateProjectFileUploads(selection);

    expect(result.accepted.map((selected) => selected.name)).toEqual([
      "uno.txt",
      "dos.txt",
      "tres.txt",
      "cuatro.txt",
    ]);
    expect(result.issue?.message).toContain("grande.png");
    expect(result.issue?.message).toContain("cinco.txt");
    expect(result.issue?.message).toContain("app.exe");
    expect(result.issue?.message).toContain("por carga");
  });

  it("rejects a file over 5 MiB before sending it to Storage", async () => {
    const oversized = { name: "grande.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 } as File;

    await expect(uploadProjectFile("project-1", oversized)).rejects.toThrow("5 MiB");
    expect(supabaseMock.upload).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it("keeps successful sibling uploads and continues after a partial failure", async () => {
    const selected = [uploadFile("ok-1.txt"), uploadFile("fallo.txt"), uploadFile("ok-2.txt")];
    const uploadOne = vi.fn(async (_projectId: string, selectedFile: File) => {
      if (selectedFile.name === "fallo.txt") throw new Error("No se pudo subir.");
    });

    const result = await uploadProjectFiles("project-1", selected, uploadOne);

    expect(uploadOne).toHaveBeenCalledTimes(3);
    expect(result.uploaded.map((uploaded) => uploaded.name)).toEqual(["ok-1.txt", "ok-2.txt"]);
    expect(result.failed.map(({ file: failedFile }) => failedFile.name)).toEqual(["fallo.txt"]);
    expect(result.failed[0]?.error.message).toBe("No se pudo subir.");
  });

  it("removes the uploaded object when recording its project row fails", async () => {
    supabaseMock.insert.mockResolvedValueOnce({ error: new Error("insert failed") });

    await expect(
      uploadProjectFile("project-1", uploadFile("nota.png", "image/png")),
    ).rejects.toThrow("No se pudo guardar «nota.png» en el proyecto.");

    expect(supabaseMock.remove).toHaveBeenCalledWith([supabaseMock.upload.mock.calls[0]?.[0]]);
  });

  it("reports when cleanup fails after the project row insert fails", async () => {
    supabaseMock.insert.mockResolvedValueOnce({ error: new Error("insert failed") });
    supabaseMock.remove.mockResolvedValueOnce({ error: new Error("remove failed") });

    await expect(
      uploadProjectFile("project-1", uploadFile("nota.png", "image/png")),
    ).rejects.toThrow("La limpieza en Storage falló; el archivo podría permanecer allí.");
    expect(supabaseMock.remove).toHaveBeenCalledTimes(1);
  });
});

describe("project instructions precedence", () => {
  it("uses the project instructions instead of the account default", () => {
    expect(pickFallbackInstructions("Instrucciones del proyecto", "Generales")).toBe(
      "Instrucciones del proyecto",
    );
  });

  it("falls back to the account default when the project has none", () => {
    expect(pickFallbackInstructions("   ", "Generales")).toBe("Generales");
  });

  it("lets the thread instructions win over the project ones", () => {
    const fallback = pickFallbackInstructions("Del proyecto", "Generales");
    const prompt = buildSystemPrompt("De la conversación", fallback);
    expect(prompt).toContain("De la conversación");
    expect(prompt).not.toContain("Del proyecto");
  });
});
