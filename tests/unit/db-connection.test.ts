import { describe, expect, it } from "vitest";

import { connectionOptions } from "@/server/db";

describe("connectionOptions", () => {
  it("uses a small pool with timeouts and no prepared statements", () => {
    expect(connectionOptions("postgresql://u:p@127.0.0.1:5432/db")).toMatchObject({
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  });

  it("requires TLS for remote hosts only", () => {
    for (const local of ["127.0.0.1", "localhost", "[::1]"]) {
      expect(connectionOptions(`postgresql://u:p@${local}:5432/db`).ssl, local).toBeUndefined();
    }
    expect(connectionOptions("postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres").ssl).toBe("require");
    expect(connectionOptions("not a url").ssl).toBe("require");
  });
});
