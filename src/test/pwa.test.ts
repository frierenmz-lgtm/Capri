import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest transforms test modules, so import.meta.url is not a file: URL here;
// the suite always runs from the project root.
const manifestPath = join(process.cwd(), "public", "manifest.webmanifest");
const swPath = join(process.cwd(), "public", "sw.js");
const iconPath = join(process.cwd(), "public", "icon-512.png");
const maskablePath = join(process.cwd(), "public", "icon-maskable.png");

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };

type ManifestShortcut = { name: string; url: string; icons?: ManifestIcon[] };

describe("installable app", () => {
  it("declara atajos en el icono: nueva conversación y mis conversaciones", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      shortcuts?: ManifestShortcut[];
    };
    const shortcuts = manifest.shortcuts ?? [];
    const byUrl = new Map(shortcuts.map((s) => [s.url, s]));
    expect(byUrl.get("/chat/nuevo")?.name).toBe("Nueva conversación");
    expect(byUrl.get("/chat")?.name).toBe("Mis conversaciones");
    for (const shortcut of shortcuts) {
      expect(shortcut.url.startsWith("/")).toBe(true);
      // Chrome ignores shortcuts without an icon.
      expect(shortcut.icons?.length).toBeGreaterThan(0);
      for (const icon of shortcut.icons ?? []) {
        expect(icon.src.startsWith("/")).toBe(true);
        // Chrome does not support SVG for shortcut icons: PNG only.
        expect(icon.type).toBe("image/png");
        expect(icon.sizes).toBe("192x192");
      }
    }
  });

  it("declara un manifiesto con lo que Chrome pide para instalar", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      background_color?: string;
      theme_color?: string;
      icons?: ManifestIcon[];
    };
    expect(manifest.name).toBe("Capri");
    expect(manifest.short_name).toBe("Capri");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
    // Chrome accepts an SVG icon with sizes "any" as the install icon;
    // one "any" entry and one "maskable" entry are required.
    const icons = manifest.icons ?? [];
    expect(icons.some((i) => i.sizes === "512x512" && (i.purpose ?? "any").includes("any") && i.type === "image/png")).toBe(true);
    expect(icons.some((i) => i.sizes === "192x192" && (i.purpose ?? "any").includes("any") && i.type === "image/png")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && (i.purpose ?? "").includes("maskable") && i.type === "image/png")).toBe(true);
    for (const icon of icons) {
      expect(icon.src.startsWith("/")).toBe(true);
      expect(icon.type).toBe("image/png");
    }
  });

  it("tiene los iconos PNG de Kiri declarados en el manifiesto", () => {
    for (const path of [iconPath, maskablePath]) {
      const png = readFileSync(path);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });

  it("el service worker atiende peticiones y versiona su caché", () => {
    const sw = readFileSync(swPath, "utf8");
    expect(sw).toContain('addEventListener("fetch"');
    expect(sw).toContain('addEventListener("install"');
    expect(sw).toContain('addEventListener("activate"');
    // Las llamadas a la API nunca se cachean.
    expect(sw).toContain('/api/');
  });
});
