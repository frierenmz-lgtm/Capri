import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "@/lib/push";

describe("urlBase64ToUint8Array", () => {
  it("decodes unpadded base64url to bytes", () => {
    expect(Array.from(urlBase64ToUint8Array("AAECAwQFBg"))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("handles the url-safe alphabet", () => {
    // bytes [251, 255, 254] encode as "+//+" in base64 and "-__-" in base64url.
    expect(Array.from(urlBase64ToUint8Array("-__-"))).toEqual([251, 255, 254]);
  });

  it("decodes a real VAPID public key to 65 bytes", () => {
    const key = "BMunb1puzGSLbF5ND6zEDnwelXS9y9zficHWpEK2iLH4GbzmYGvYH_UBbtdZl0MVB9foNTaP7qALq6qL7ESC-ko";
    expect(urlBase64ToUint8Array(key).length).toBe(65);
  });
});
