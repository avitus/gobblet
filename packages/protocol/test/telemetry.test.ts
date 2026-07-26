import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENT_NAMES,
  CLIENT_ANALYTICS_EVENT_NAMES,
  TELEMETRY_BATCH_MAX,
  TELEMETRY_MESSAGE_MAX_LENGTH,
  analyticsEventSchema,
  clientAnalyticsEventSchema,
  isAnalyticsEventName,
  telemetryErrorRequestSchema,
  telemetryEventsRequestSchema,
  type AnalyticsEvent,
} from "../src/index";
import { MATCH_ID } from "./helpers/fixtures";

const launched: AnalyticsEvent = {
  name: "app-launched",
  platform: "web",
  clientVersion: "0.1.0",
};

describe("the analytics event list", () => {
  it("names every event section 17.1 asks for", () => {
    expect([...ANALYTICS_EVENT_NAMES]).toEqual([
      "app-launched",
      "render-tier-selected",
      "setting-changed",
      "guest-created",
      "sign-up-completed",
      "signed-in",
      "queue-joined",
      "match-found",
      "match-started",
      "match-completed",
      "rematch-requested",
      "rematch-accepted",
      "desktop-update-completed",
    ]);
    expect(isAnalyticsEventName("match-completed")).toBe(true);
    expect(isAnalyticsEventName("board-state")).toBe(false);
  });

  it("has a schema for every name, and no schema without a name", () => {
    const named = ANALYTICS_EVENT_NAMES.map((name) => name).sort();
    const shaped = analyticsEventSchema.options
      .map((option) => option.shape.name.value as string)
      .sort();
    expect(shaped).toEqual(named);
  });

  it("accepts only the client subset from a browser", () => {
    expect([...CLIENT_ANALYTICS_EVENT_NAMES]).toEqual([
      "app-launched",
      "render-tier-selected",
      "setting-changed",
      "desktop-update-completed",
    ]);
    expect(clientAnalyticsEventSchema.parse(launched)).toEqual(launched);
    expect(
      clientAnalyticsEventSchema.safeParse({
        name: "match-completed",
        mode: "ranked",
        timeControlSeconds: 300,
        result: "light",
        endReason: "line",
        moveCount: 12,
        durationMs: 370_000,
      }).success,
    ).toBe(false);
  });

  it("carries no free-form property anywhere", () => {
    expect(analyticsEventSchema.safeParse({ ...launched, email: "ada@example.com" }).success).toBe(
      false,
    );
    expect(
      analyticsEventSchema.safeParse({ name: "setting-changed", setting: "whatever-i-like" })
        .success,
    ).toBe(false);
    expect(
      analyticsEventSchema.parse({
        name: "setting-changed",
        setting: "sound-muted",
        enabled: true,
      }),
    ).toEqual({ name: "setting-changed", setting: "sound-muted", enabled: true });
  });

  it("describes a completed match by its result rather than its moves", () => {
    const completed = analyticsEventSchema.parse({
      name: "match-completed",
      mode: "ranked",
      timeControlSeconds: 300,
      result: "light",
      endReason: "line",
      moveCount: 12,
      durationMs: 370_000,
    });
    expect(completed).not.toHaveProperty("moves");
    expect(
      analyticsEventSchema.safeParse({
        name: "match-completed",
        mode: "ranked",
        timeControlSeconds: 300,
        result: "light",
        endReason: "line",
        moveCount: 12,
        durationMs: 370_000,
        moves: ["r0c0"],
      }).success,
    ).toBe(false);
  });

  it("knows one authentication method, because there is one", () => {
    expect(analyticsEventSchema.parse({ name: "signed-in", method: "password" }).name).toBe(
      "signed-in",
    );
    expect(
      analyticsEventSchema.safeParse({ name: "signed-in", method: "magic-link" }).success,
    ).toBe(false);
  });
});

describe("the telemetry intake", () => {
  it("batches, but not without bound", () => {
    expect(TELEMETRY_BATCH_MAX).toBe(20);
    expect(telemetryEventsRequestSchema.parse({ events: [launched] }).events).toHaveLength(1);
    expect(telemetryEventsRequestSchema.safeParse({ events: [] }).success).toBe(false);
    expect(
      telemetryEventsRequestSchema.safeParse({
        events: Array.from({ length: TELEMETRY_BATCH_MAX + 1 }, () => launched),
      }).success,
    ).toBe(false);
  });

  it("bounds a reported error and takes a route rather than a URL", () => {
    const report = telemetryErrorRequestSchema.parse({
      name: "TypeError",
      message: "Cannot read properties of null",
      route: "/match/:matchId",
      matchId: MATCH_ID,
    });
    expect(report.route).toBe("/match/:matchId");
    expect(
      telemetryErrorRequestSchema.safeParse({
        name: "TypeError",
        message: "x".repeat(TELEMETRY_MESSAGE_MAX_LENGTH + 1),
        route: "/match/:matchId",
      }).success,
    ).toBe(false);
    expect(
      telemetryErrorRequestSchema.safeParse({
        name: "TypeError",
        message: "boom",
        route: "/",
        sessionToken: "secret",
      }).success,
    ).toBe(false);
  });
});
