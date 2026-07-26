import { describe, expect, it } from "vitest";
import {
  UNKNOWN_CAPABILITIES,
  detectCapabilities,
  downgradeTier,
  resolveTier,
  tierSettings,
} from "../src/tier";
import type { Capabilities } from "../src/tier";

const CAPABLE: Capabilities = { webgl2: true, webgl1: true, slow: false, cores: 8 };

/**
 * Stands in for a browser that offers WebGL 1 only: the modern context is refused
 * and the legacy one answers, which is how the detector tells the two apart.
 */
function fakeDocument(
  context: unknown,
  options: Readonly<{ throwOnCreate?: boolean; webgl2?: boolean }> = {},
): Pick<Document, "createElement"> {
  return {
    createElement: () => {
      if (options.throwOnCreate === true) {
        throw new Error("no document");
      }
      return {
        getContext: (kind: string) =>
          kind === "webgl2" && options.webgl2 !== true ? null : context,
      } as unknown as HTMLElement;
    },
  } as Pick<Document, "createElement">;
}

describe("rendering tiers", () => {
  it("takes the best tier a capable machine offers", () => {
    expect(resolveTier(CAPABLE)).toBe("full");
  });

  it("drops to reduced for a slow renderer, no WebGL2, or two cores", () => {
    expect(resolveTier({ ...CAPABLE, slow: true })).toBe("reduced");
    expect(resolveTier({ ...CAPABLE, webgl2: false })).toBe("reduced");
    expect(resolveTier({ ...CAPABLE, cores: 2 })).toBe("reduced");
    expect(resolveTier({ ...CAPABLE, cores: null })).toBe("full");
  });

  it("falls back to the flat board when there is no context at all", () => {
    expect(resolveTier(UNKNOWN_CAPABILITIES)).toBe("flat");
    expect(resolveTier(UNKNOWN_CAPABILITIES, "full")).toBe("flat");
  });

  it("honours an explicit preference on a machine that can present it", () => {
    expect(resolveTier(CAPABLE, "reduced")).toBe("reduced");
    expect(resolveTier(CAPABLE, "flat")).toBe("flat");
    expect(resolveTier({ ...CAPABLE, slow: true }, "full")).toBe("full");
  });

  it("downgrades a running client one step at a time", () => {
    expect(downgradeTier("full")).toBe("reduced");
    expect(downgradeTier("reduced")).toBe("flat");
    expect(downgradeTier("flat")).toBe("flat");
  });

  it("caps the pixel ratio and the effects per tier", () => {
    expect(tierSettings("full")).toEqual({
      tier: "full",
      pixelRatioCap: 2,
      shadows: true,
      antialias: true,
    });
    expect(tierSettings("reduced")).toEqual({
      tier: "reduced",
      pixelRatioCap: 1.5,
      shadows: false,
      antialias: false,
    });
    expect(tierSettings("flat")).toEqual({
      tier: "flat",
      pixelRatioCap: 1,
      shadows: false,
      antialias: false,
    });
  });
});

describe("capability detection", () => {
  it("reads no WebGL when a context cannot be created", () => {
    expect(detectCapabilities(fakeDocument(null), { hardwareConcurrency: 4 })).toEqual({
      webgl2: false,
      webgl1: false,
      slow: false,
      cores: 4,
    });
  });

  it("reads no WebGL when the document itself refuses", () => {
    expect(
      detectCapabilities(fakeDocument(null, { throwOnCreate: true }), { hardwareConcurrency: 4 }),
    ).toEqual(UNKNOWN_CAPABILITIES);
  });

  it("reads WebGL2 when the modern context answers", () => {
    const context = { getExtension: () => null };

    expect(
      detectCapabilities(fakeDocument(context, { webgl2: true }), { hardwareConcurrency: 8 }),
    ).toEqual({ webgl2: true, webgl1: true, slow: false, cores: 8 });
  });

  it("names a software renderer as slow", () => {
    const context = {
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 37446 }),
      getParameter: () => "Google SwiftShader",
    };

    expect(detectCapabilities(fakeDocument(context), { hardwareConcurrency: 0 })).toEqual({
      webgl2: false,
      webgl1: true,
      slow: true,
      cores: null,
    });
  });

  it("trusts a renderer that reports hardware, or reports nothing at all", () => {
    const named = {
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 37446 }),
      getParameter: () => "Apple M2 Pro",
    };
    expect(detectCapabilities(fakeDocument(named), { hardwareConcurrency: 10 }).slow).toBe(false);

    const anonymous = { getExtension: () => null, getParameter: () => "" };
    expect(detectCapabilities(fakeDocument(anonymous), { hardwareConcurrency: 10 }).slow).toBe(
      false,
    );

    const unreadable = {
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 37446 }),
      getParameter: () => 12,
    };
    expect(detectCapabilities(fakeDocument(unreadable), { hardwareConcurrency: 10 }).slow).toBe(
      false,
    );
  });

  it("survives a context call that throws", () => {
    const canvas = {
      getContext: () => {
        throw new Error("context refused");
      },
    };
    const documentLike = {
      createElement: () => canvas as unknown as HTMLElement,
    } as Pick<Document, "createElement">;

    expect(detectCapabilities(documentLike, { hardwareConcurrency: 6 })).toEqual({
      webgl2: false,
      webgl1: false,
      slow: false,
      cores: 6,
    });
  });
});
