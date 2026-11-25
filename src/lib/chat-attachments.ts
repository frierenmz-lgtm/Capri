export type AttachmentValidationCode = "max_files" | "max_file_size" | "accept" | "rejected";

export type AttachmentValidationIssue = {
  code: AttachmentValidationCode;
  message: string;
};

export type AttachmentValidationOptions = {
  accept?: string | undefined;
  currentCount?: number | undefined;
  maxFiles?: number | undefined;
  maxFilesContext?: "mensaje" | "carga" | undefined;
  maxFileSize?: number | undefined;
};

export type AttachmentValidationResult = {
  accepted: File[];
  issue?: AttachmentValidationIssue;
};

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept?.trim()) return true;
  const patterns = accept
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  return patterns.some((pattern) => {
    if (pattern.startsWith(".")) return file.name.toLowerCase().endsWith(pattern.toLowerCase());
    if (pattern.endsWith("/*")) return file.type.startsWith(pattern.slice(0, -1));
    return file.type === pattern;
  });
}

function fileNames(files: File[]): string {
  const shown = files.slice(0, 3).map((file) => `«${file.name}»`);
  const remaining = files.length - shown.length;
  return `${shown.join(", ")}${remaining > 0 ? ` y ${remaining} más` : ""}`;
}

/** Validate all files together so partial acceptance always reports what was skipped. */
export function validateChatAttachments(
  incoming: readonly File[],
  options: AttachmentValidationOptions = {},
): AttachmentValidationResult {
  const unsupported = incoming.filter((file) => !matchesAccept(file, options.accept));
  const supported = incoming.filter((file) => matchesAccept(file, options.accept));
  const oversized = supported.filter(
    (file) => typeof options.maxFileSize === "number" && file.size > options.maxFileSize,
  );
  const withinSize = supported.filter((file) => !oversized.includes(file));
  const capacity =
    typeof options.maxFiles === "number"
      ? Math.max(0, options.maxFiles - (options.currentCount ?? 0))
      : undefined;
  const accepted = typeof capacity === "number" ? withinSize.slice(0, capacity) : withinSize;
  const tooMany = withinSize.slice(accepted.length);

  const reasons: { code: Exclude<AttachmentValidationCode, "rejected">; text: string }[] = [];
  if (unsupported.length > 0) {
    reasons.push({
      code: "accept",
      text: `No se agregaron ${fileNames(unsupported)} porque no son compatibles; usa imágenes, PDF o archivos de texto.`,
    });
  }
  if (oversized.length > 0) {
    reasons.push({
      code: "max_file_size",
      text: `No se agregaron ${fileNames(oversized)} porque exceden el tamaño permitido.`,
    });
  }
  if (tooMany.length > 0) {
    reasons.push({
      code: "max_files",
      text: `No se agregaron ${fileNames(tooMany)}; el máximo es ${options.maxFiles} archivos por ${options.maxFilesContext ?? "mensaje"}.`,
    });
  }

  if (reasons.length === 0) return { accepted };
  return {
    accepted,
    issue: {
      code: reasons.length === 1 ? reasons[0]!.code : "rejected",
      message: reasons.map((reason) => reason.text).join(" "),
    },
  };
}

export type UploadedBatchItem<T> = {
  path: string;
  value: T;
};

/** Wait for every parallel upload to settle and remove all successful files if any sibling fails. */
export async function uploadBatchWithCleanup<TInput, TValue>(
  inputs: readonly TInput[],
  uploadOne: (input: TInput) => Promise<UploadedBatchItem<TValue>>,
  removeUploaded: (paths: string[]) => Promise<void>,
): Promise<TValue[]> {
  const results = await Promise.allSettled(inputs.map((input) => uploadOne(input)));
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (!failure) {
    return results.map(
      (result) => (result as PromiseFulfilledResult<UploadedBatchItem<TValue>>).value.value,
    );
  }

  const uploadedPaths = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value.path] : [],
  );
  const originalError =
    failure.reason instanceof Error
      ? failure.reason
      : new Error("No se pudieron subir los archivos.");
  if (uploadedPaths.length > 0) {
    try {
      await removeUploaded(uploadedPaths);
    } catch (cleanupError) {
      const cleanupMessage =
        cleanupError instanceof Error
          ? cleanupError.message
          : "Error al borrar las cargas parciales.";
      throw new Error(
        `${originalError.message} Además, no se pudieron limpiar las cargas parciales: ${cleanupMessage}`,
      );
    }
  }
  throw originalError;
}
