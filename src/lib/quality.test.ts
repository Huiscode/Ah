import { describe, expect, it } from "vitest";
import { qualityColorClass, qualityColorClassById } from "@/lib/quality";

describe("qualityColorClass", () => {
  it("maps WoW item qualities to their canonical colors", () => {
    expect(qualityColorClass("poor")).toBe("text-wow-poor");
    expect(qualityColorClass("common")).toBe("text-wow-common");
    expect(qualityColorClass("uncommon")).toBe("text-wow-uncommon");
    expect(qualityColorClass("rare")).toBe("text-wow-rare");
    expect(qualityColorClass("epic")).toBe("text-wow-epic");
    expect(qualityColorClass("legendary")).toBe("text-wow-legendary");
  });

  it("falls back to common white for unknown qualities", () => {
    expect(qualityColorClass("unknown")).toBe("text-wow-common");
    expect(qualityColorClass("")).toBe("text-wow-common");
  });
});

describe("qualityColorClassById", () => {
  it("maps numeric WoW qualities to their canonical colors", () => {
    expect(qualityColorClassById(0)).toBe("text-wow-poor");
    expect(qualityColorClassById(1)).toBe("text-wow-common");
    expect(qualityColorClassById(2)).toBe("text-wow-uncommon");
    expect(qualityColorClassById(3)).toBe("text-wow-rare");
    expect(qualityColorClassById(4)).toBe("text-wow-epic");
    expect(qualityColorClassById(5)).toBe("text-wow-legendary");
  });

  it("falls back to common white for missing or out-of-range qualities", () => {
    expect(qualityColorClassById(undefined)).toBe("text-wow-common");
    expect(qualityColorClassById(6)).toBe("text-wow-common");
    expect(qualityColorClassById(7)).toBe("text-wow-common");
  });
});
