import { describe, expect, test } from "bun:test";
import { createTiltEnvironment } from "./tilt-cli";

describe("createTiltEnvironment", () => {
  test("does not forward broad secret-like environment variables", () => {
    try {
      process.env.API_TOKEN = "secret";
      process.env.AWS_SECRET_ACCESS_KEY = "secret";
      process.env.TILT_CUSTOM = "kept";

      const env = createTiltEnvironment({ EDITOR: "cat" });

      expect(env.API_TOKEN).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env.TILT_CUSTOM).toBe("kept");
      expect(env.EDITOR).toBe("cat");
      expect(env.TILT_DISABLE_ANALYTICS).toBe("true");
      expect(env.DO_NOT_TRACK).toBe("true");
    } finally {
      delete process.env.API_TOKEN;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.TILT_CUSTOM;
    }
  });
});
