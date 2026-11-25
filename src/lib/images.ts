import type { FileUIPart } from "ai";

/** Storage for everything users attach (images and documents); name kept for existing files. */
export const IMAGE_BUCKET = "chat-images";
export const IMAGE_SCHEME = "capri-image://";
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Longest document text Capri reads per file; the rest is cut with a note. */
export const MAX_DOCUMENT_CHARS = 60_000;
export const DOCUMENT_ATTACHMENT_PREFIX = "Archivo adjunto: ";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const TEXT_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "log",
  "html",
  "htm",
  "css",
  "scss",
  "js",
  "jsx",
  "mjs",
  "ts",
  "tsx",
  "py",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "go",
  "rs",
  "rb",
  "php",
  "sh",
  "bash",
  "sql",
  "r",
  "lua",
  "dart",
  "vue",
  "svelte",
];

export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
/** What the attach button and drop zone allow: images, PDFs and plain-text files (by type or extension). */
export const ATTACH_ACCEPT = [
  ...IMAGE_TYPES,
  "application/pdf",
  "text/*",
  ...TEXT_EXTENSIONS.map((e) => `.${e}`),
].join(",");

export type AttachmentKind = "image" | "pdf" | "text";

function extension(filename?: string | null): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename ?? "");
  return m ? m[1]!.toLowerCase() : "";
}

/** Which kind of attachment a file is, or null when Capri can't read it. */
export function attachmentKind(mediaType: string, filename?: string | null): AttachmentKind | null {
  if (IMAGE_TYPES.includes(mediaType)) return "image";
  const ext = extension(filename);
  if (mediaType === "application/pdf" || ext === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.includes(ext)) return "text";
  if (mediaType.startsWith("text/")) return "text";
  return null;
}

/** The text block Capri receives for an attached text file. */
export function documentText(filename: string, content: string): string {
  const cut = content.length > MAX_DOCUMENT_CHARS;
  const body = cut ? content.slice(0, MAX_DOCUMENT_CHARS) : content;
  const note = cut
    ? `[El archivo es más largo; solo se incluyen los primeros ${MAX_DOCUMENT_CHARS} caracteres.]\n`
    : "";
  return `${DOCUMENT_ATTACHMENT_PREFIX}${filename}\n${note}<<<\n${body}\n>>>`;
}

/** Storage path from a saved file part url, or null if it isn't one of ours. */
export function imagePath(url: string): string | null {
  return url.startsWith(IMAGE_SCHEME) ? url.slice(IMAGE_SCHEME.length) : null;
}

/** A path is only usable by the user whose id is its first folder. */
export function ownsImagePath(path: string, userId: string): boolean {
  const parts = path.split("/");
  return parts.length === 2 && parts[0] === userId && !parts.includes("..") && parts[1]!.length > 0;
}

export function isImagePart(p: { type: string; mediaType?: string }): p is FileUIPart {
  return (
    p.type === "file" && attachmentKind(p.mediaType ?? "", (p as FileUIPart).filename) === "image"
  );
}
