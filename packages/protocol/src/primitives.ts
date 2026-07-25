import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH } from "./constants";

export const uuidSchema = z.uuid();

export const matchVersionSchema = z.int().nonnegative();

export const epochMillisSchema = z.int().positive();

export const remainingMillisSchema = z.int().nonnegative();

export const isoTimestampSchema = z.iso.datetime();

export const displayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN_LENGTH)
  .max(DISPLAY_NAME_MAX_LENGTH);
