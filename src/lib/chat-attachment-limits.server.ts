import type { FileUIPart } from "ai";
import type { UserClient } from "./auth-request.server";
import {
  IMAGE_BUCKET,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  attachmentKind,
  imagePath,
  ownsImagePath,
} from "./images";

export type ChatAttachmentMetadata = { size: number; contentEncoding?: string };
export type ChatAttachmentMetadataCache = Map<string, ChatAttachmentMetadata>;

export class ChatAttachmentLimitError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ChatAttachmentLimitError";
  }
}

/** Reads storage metadata only; it never fetches the file body. */
export async function readChatAttachmentMetadata(
  supabase: UserClient,
  path: string,
  cache: ChatAttachmentMetadataCache,
): Promise<ChatAttachmentMetadata | null> {
  const cached = cache.get(path);
  if (cached) return cached;

  const [folder, filename] = path.split("/");
  if (!folder || !filename) return null;

  try {
    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .list(folder, { search: filename, limit: 100 });
    const file = data?.find((entry) => entry.id !== null && entry.name === filename);
    const size = file?.metadata?.size;
    if (error || typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;

    const contentEncoding = file?.metadata?.["contentEncoding"];
    const metadata: ChatAttachmentMetadata = {
      size,
      ...(typeof contentEncoding === "string" ? { contentEncoding } : {}),
    };
    cache.set(path, metadata);
    return metadata;
  } catch {
    return null;
  }
}

export async function validateChatAttachment(
  supabase: UserClient,
  userId: string,
  part: FileUIPart,
  cache: ChatAttachmentMetadataCache,
): Promise<string> {
  const path = imagePath(part.url);
  const kind = attachmentKind(part.mediaType, part.filename);
  if (!path || !kind || !ownsImagePath(path, userId)) {
    throw new ChatAttachmentLimitError("Archivo adjunto no válido.");
  }

  const metadata = await readChatAttachmentMetadata(supabase, path, cache);
  if (!metadata) {
    throw new ChatAttachmentLimitError("No se pudo verificar el tamaño de un archivo adjunto.");
  }
  const contentEncoding = metadata.contentEncoding?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    throw new ChatAttachmentLimitError("No se admiten archivos adjuntos con compresión.");
  }
  if (metadata.size > MAX_IMAGE_BYTES) {
    throw new ChatAttachmentLimitError("Cada archivo debe pesar 5 MB o menos.", 413);
  }
  return path;
}

/** Enforces the existing per-message count and per-file byte limits for a new chat message. */
export async function validateChatMessageAttachments(
  supabase: UserClient,
  userId: string,
  message: { parts: Array<unknown> },
  cache: ChatAttachmentMetadataCache,
): Promise<void> {
  const files = message.parts.filter(
    (part): part is FileUIPart =>
      !!part && typeof part === "object" && (part as { type?: unknown }).type === "file",
  );
  if (files.length > MAX_IMAGES) {
    throw new ChatAttachmentLimitError(`Máximo ${MAX_IMAGES} archivos por mensaje.`, 413);
  }
  await Promise.all(files.map((part) => validateChatAttachment(supabase, userId, part, cache)));
}
