import { describe, expect, it } from "vitest";

import { DEFAULT_VIBE_CYCLE } from "@/features/vibe/config";
import { resolveVibeSettings } from "@/features/vibe/settings";

const resolve = (cycle: unknown, defaultVibe: unknown, heroEnabled: unknown = true) =>
  resolveVibeSettings({ cycle, defaultVibe, heroEnabled });

describe("resolveVibeSettings", () => {
  it("keeps a valid cycle and default", () => {
    expect(resolve(["bold", "cute"], "cute")).toEqual({
      cycle: ["bold", "cute"],
      defaultVibe: "cute",
      heroEnabled: true,
    });
  });

  it("drops unknown slugs and duplicates; an empty or invalid cycle becomes all four vibes", () => {
    expect(resolve(["bold", "nope", "bold"], "bold").cycle).toEqual(["bold"]);
    expect(resolve([], "cute").cycle).toEqual([...DEFAULT_VIBE_CYCLE]);
    expect(resolve("cute", "cute").cycle).toEqual([...DEFAULT_VIBE_CYCLE]);
    expect(resolve(undefined, undefined).cycle).toEqual([...DEFAULT_VIBE_CYCLE]);
  });

  it("puts a default that is not in the cycle back into it (the head script needs it)", () => {
    expect(resolve(["bold", "funky"], "gothic").defaultVibe).toBe("bold");
    expect(resolve(["bold", "funky"], "nope").defaultVibe).toBe("bold");
  });

  it("keeps 'random' and falls back to cute for a missing default", () => {
    expect(resolve(["bold", "funky"], "random").defaultVibe).toBe("random");
    expect(resolve(undefined, undefined).defaultVibe).toBe("cute");
  });

  it("hero_enabled: only an explicit false turns the animated hero off", () => {
    expect(resolve(undefined, undefined, false).heroEnabled).toBe(false);
    expect(resolve(undefined, undefined, true).heroEnabled).toBe(true);
    expect(resolve(undefined, undefined, undefined).heroEnabled).toBe(true);
  });
});
