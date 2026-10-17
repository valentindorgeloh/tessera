/**
 * Identifier field of the General settings tab (src/components/project-settings/identifier.ts).
 */
import { describe, expect, it } from "vitest";
import { identifierError, sanitizeIdentifier } from "@/components/project-settings/identifier";

describe("sanitizeIdentifier", () => {
  it("upper-cases and drops everything but letters and digits", () => {
    expect(sanitizeIdentifier("web-2 app!")).toBe("WEB2APP");
  });

  it("caps at 12 characters", () => {
    expect(sanitizeIdentifier("abcdefghijklmnop")).toBe("ABCDEFGHIJKL");
  });

  it("returns an empty string for nothing usable", () => {
    expect(sanitizeIdentifier("--- ")).toBe("");
  });
});

describe("identifierError", () => {
  it("accepts 2 to 12 letters or digits starting with a letter", () => {
    expect(identifierError("WE")).toBeNull();
    expect(identifierError("A1B2C3D4E5F6")).toBeNull();
  });

  it("refuses a short, digit-leading or empty identifier", () => {
    const message = "Use 2–12 letters or digits, starting with a letter";
    expect(identifierError("")).toBe(message);
    expect(identifierError("W")).toBe(message);
    expect(identifierError("1AB")).toBe(message);
  });

  it("refuses what sanitizeIdentifier would not produce", () => {
    expect(identifierError("web")).not.toBeNull();
    expect(identifierError("W-B")).not.toBeNull();
    expect(identifierError("ABCDEFGHIJKLM")).not.toBeNull();
  });
});
