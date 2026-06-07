import { describe, expect, it } from "vitest";
import { getUploadMaterialTitle, titleFromFilename } from "./helpers.js";

describe("library upload title helpers", () => {
  it("normalizes filename stems into readable titles", () => {
    expect(titleFromFilename("Moonlight-Sonata_v2.pdf")).toBe(
      "Moonlight Sonata v2",
    );
  });

  it("prefers extracted score titles over filenames", () => {
    expect(
      getUploadMaterialTitle(
        "fallback-name.musicxml",
        "  Fixture\u00a0Score\u00a0Title  ",
      ),
    ).toBe("Fixture Score Title");
  });
});
