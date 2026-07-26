import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom has no graphics context and reports the missing implementation through its
 * virtual console. Answering `null` is what a browser without WebGL does, and it
 * keeps the output readable; the real contexts are exercised by the browser suite.
 */
HTMLCanvasElement.prototype.getContext = () => null;

afterEach(() => {
  cleanup();
});
