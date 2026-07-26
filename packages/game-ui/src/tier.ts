/**
 * The three presentation tiers of ADR-0023. `flat` needs no WebGL at all, so a
 * machine that cannot present a canvas can still play a complete match.
 */
export const RENDER_TIERS = Object.freeze(["full", "reduced", "flat"] as const);

export type RenderTier = (typeof RENDER_TIERS)[number];

export type RenderTierPreference = RenderTier | "auto";

export type Capabilities = Readonly<{
  /** A WebGL2 context could be created. */
  webgl2: boolean;
  /** A WebGL1 context could be created. */
  webgl1: boolean;
  /** The context reported itself as a software or otherwise slow renderer. */
  slow: boolean;
  /** Logical processor count, where the browser reports it. */
  cores: number | null;
}>;

export const UNKNOWN_CAPABILITIES: Capabilities = Object.freeze({
  webgl2: false,
  webgl1: false,
  slow: false,
  cores: null,
});

const SOFTWARE_RENDERER_MARKERS = Object.freeze([
  "swiftshader",
  "software",
  "llvmpipe",
  "basic render driver",
]);

/**
 * Asks the browser what it can do, once, at startup. Any failure is read as "no
 * WebGL", because a client that cannot create a context must not try to draw.
 */
export function detectCapabilities(
  documentLike: Pick<Document, "createElement"> = document,
  navigatorLike: Pick<Navigator, "hardwareConcurrency"> = navigator,
): Capabilities {
  let canvas: HTMLCanvasElement;
  try {
    canvas = documentLike.createElement("canvas");
  } catch {
    return UNKNOWN_CAPABILITIES;
  }

  const webgl2 = tryContext(canvas, "webgl2");
  const context = webgl2 ?? tryContext(canvas, "webgl");
  if (!context) {
    return {
      ...UNKNOWN_CAPABILITIES,
      cores: readCores(navigatorLike),
    };
  }

  return {
    webgl2: webgl2 !== null,
    webgl1: true,
    slow: isSoftwareRenderer(context),
    cores: readCores(navigatorLike),
  };
}

function readCores(navigatorLike: Pick<Navigator, "hardwareConcurrency">): number | null {
  const cores = navigatorLike.hardwareConcurrency;
  return typeof cores === "number" && cores > 0 ? cores : null;
}

function tryContext(canvas: HTMLCanvasElement, kind: "webgl2" | "webgl"): RenderingContext | null {
  try {
    return canvas.getContext(kind);
  } catch {
    return null;
  }
}

function isSoftwareRenderer(context: RenderingContext): boolean {
  const gl = context as WebGLRenderingContext;
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) {
    return false;
  }
  const renderer: unknown = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  if (typeof renderer !== "string") {
    return false;
  }
  const lowered = renderer.toLowerCase();
  return SOFTWARE_RENDERER_MARKERS.some((marker) => lowered.includes(marker));
}

/**
 * Chooses the tier from the capabilities, honouring an explicit preference. A
 * preference for a tier the machine cannot present is lowered rather than obeyed,
 * because an unusable board is worse than a plain one.
 */
export function resolveTier(
  capabilities: Capabilities,
  preference: RenderTierPreference = "auto",
): RenderTier {
  if (!capabilities.webgl1 && !capabilities.webgl2) {
    return "flat";
  }
  if (preference !== "auto") {
    return preference;
  }
  if (capabilities.slow || !capabilities.webgl2) {
    return "reduced";
  }
  if (capabilities.cores !== null && capabilities.cores <= 2) {
    return "reduced";
  }
  return "full";
}

/** The tier to run after a WebGL context is lost and cannot be restored. */
export function downgradeTier(tier: RenderTier): RenderTier {
  switch (tier) {
    case "full":
      return "reduced";
    case "reduced":
    case "flat":
      return "flat";
  }
}

export type TierSettings = Readonly<{
  tier: RenderTier;
  /** Device pixel ratio ceiling, so a dense display cannot cost the frame budget. */
  pixelRatioCap: number;
  shadows: boolean;
  antialias: boolean;
}>;

export function tierSettings(tier: RenderTier): TierSettings {
  switch (tier) {
    case "full":
      return { tier, pixelRatioCap: 2, shadows: true, antialias: true };
    case "reduced":
      return { tier, pixelRatioCap: 1.5, shadows: false, antialias: false };
    case "flat":
      return { tier, pixelRatioCap: 1, shadows: false, antialias: false };
  }
}
