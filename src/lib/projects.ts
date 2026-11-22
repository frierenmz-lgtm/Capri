import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { IMAGE_BUCKET, IMAGE_SCHEME, attachmentKind } from "./images";
import { MAX_PROJECT_NAME } from "./project-context";
import type { Thread } from "./threads";

export { MAX_PROJECT_FILES, MAX_PROJECT_CONTEXT_CHARS, MAX_PROJECT_NAME } from "./project-context";
export { budgetProjectTexts, projectFileText, selectProjectFiles } from "./project-context";

export type Project = {
  id: string;
  name: string;
  instructions: string;
  created_at: string;
  updated_at: string;
};

export type ProjectFile = {
  id: string;
  project_id: string;
  name: string;
  storage_path: string;
  media_type: string;
  created_at: string;
};

export const projectsQuery = queryOptions({
  queryKey: ["projects"],
  queryFn: async (): Promise<Project[]> => {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,instructions,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});

export const projectQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["project", projectId],
    queryFn: async (): Promise<{ project: Project | null; files: ProjectFile[] }> => {
      const [{ data: project, error: projectError }, { data: files, error: filesError }] = await Promise.all([
        supabase.from("projects").select("id,name,instructions,created_at,updated_at").eq("id", projectId).maybeSingle(),
        supabase
          .from("project_files")
          .select("id,project_id,name,storage_path,media_type,created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false }),
      ]);
      if (projectError) throw projectError;
      if (filesError) throw filesError;
      return { project, files: files ?? [] };
    },
  });

export const projectThreadsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["project-threads", projectId],
    queryFn: async (): Promise<Thread[]> => {
      const { data, error } = await supabase
        .from("threads")
        .select("id,title,updated_at,pinned,project_id")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export async function createProject(name: string): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Inicia sesión para crear proyectos.");
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: auth.user.id, name: name.trim().slice(0, MAX_PROJECT_NAME) })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function renameProject(id: string, name: string) {
  const { error } = await supabase
    .from("projects")
    .update({ name: name.trim().slice(0, MAX_PROJECT_NAME), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id: string) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function saveProjectInstructions(id: string, value: string) {
  const { error } = await supabase
    .from("projects")
    .update({ instructions: value, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

function storageExt(kind: "image" | "pdf" | "text", mediaType: string): string {
  if (kind === "image") return (mediaType.split("/")[1] ?? "png").replace("jpeg", "jpg");
  if (kind === "pdf") return "pdf";
  return "txt";
}

/** Uploads a file to the project (same storage as chat attachments) and records it. */
export async function uploadProjectFile(projectId: string, file: File): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Inicia sesión para subir archivos.");
  const kind = attachmentKind(file.type, file.name);
  if (!kind) throw new Error(`No puedo leer «${file.name}». Usa imágenes, PDF o archivos de texto.`);
  if (kind === "text") {
    const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
    if (head.includes(0)) throw new Error(`«${file.name}» no parece un archivo de texto.`);
  }
  const mediaType = kind === "pdf" ? "application/pdf" : kind === "text" ? "text/plain" : file.type;
  const path = `${uid}/${crypto.randomUUID()}.${storageExt(kind, file.type)}`;
  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: kind === "text" ? "text/plain;charset=utf-8" : mediaType });
  if (uploadError) throw new Error(`No se pudo subir «${file.name}».`);
  const { error } = await supabase.from("project_files").insert({
    project_id: projectId,
    user_id: uid,
    name: file.name,
    storage_path: path,
    media_type: mediaType,
  });
  if (error) {
    await supabase.storage.from(IMAGE_BUCKET).remove([path]);
    throw error;
  }
}

export async function deleteProjectFile(file: ProjectFile) {
  const { error } = await supabase.from("project_files").delete().eq("id", file.id);
  if (error) throw error;
  await supabase.storage.from(IMAGE_BUCKET).remove([file.storage_path]);
}

/** Storage URL for a project file, in the same scheme as chat attachments. */
export function projectFileUrl(file: ProjectFile): string {
  return IMAGE_SCHEME + file.storage_path;
}
