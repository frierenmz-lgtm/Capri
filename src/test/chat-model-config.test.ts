import { describe, expect, it } from "vitest";
import { parseCustomChatModelConfig } from "@/lib/chat-model-config";

describe("parseCustomChatModelConfig", () => {
  it("rechaza URL o clave ausentes o en blanco", () => {
    expect(parseCustomChatModelConfig(undefined, "secret")).toBeNull();
    expect(parseCustomChatModelConfig("https://model.example/v1", "  ")).toBeNull();
  });

  it("rechaza URL malformadas, esquemas no HTTP y credenciales embebidas", () => {
    expect(parseCustomChatModelConfig("not a url", "secret")).toBeNull();
    expect(parseCustomChatModelConfig("ftp://model.example/v1", "secret")).toBeNull();
    expect(parseCustomChatModelConfig("https://user:pass@model.example/v1", "secret")).toBeNull();
  });

  it("normaliza espacios periféricos de una configuración HTTP compatible", () => {
    expect(parseCustomChatModelConfig(" https://model.example/v1/ ", " secret ")).toEqual({
      baseURL: "https://model.example/v1/",
      apiKey: "secret",
    });
  });
});
