import { describe, expect, it } from "vitest";
import { canonicalJsonb, sha256Jsonb } from "./hash";

describe("Postgres jsonb-compatible hashing", () => {
  it("sorts object keys and keeps jsonb whitespace stable", () => {
    expect(canonicalJsonb({ z: [2, { b: true, a: "x" }], a: 1 })).toBe('{"a": 1, "z": [2, {"a": "x", "b": true}]}');
  });

  it("orders keys by UTF-8 byte length then binary value as PostgreSQL does", () => {
    expect(canonicalJsonb({ aa: 2, z: 1, "中": 4, "é": 3, a: 0 })).toBe('{"a": 0, "z": 1, "aa": 2, "é": 3, "中": 4}');
    expect(canonicalJsonb([1e-7, 1e21])).toBe("[0.0000001, 1000000000000000000000]");
  });

  it("produces a stable lowercase sha256 digest", async () => {
    const first = await sha256Jsonb({ b: "x", a: 1 });
    const second = await sha256Jsonb({ a: 1, b: "x" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
