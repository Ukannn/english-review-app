function jsonbText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON number must be finite");
    const encoded = JSON.stringify(value);
    if (!/[eE]/.test(encoded)) return encoded;
    const [coefficient, exponent] = encoded.toLowerCase().split("e");
    const negative = coefficient.startsWith("-");
    const unsigned = negative ? coefficient.slice(1) : coefficient;
    const digits = unsigned.replace(".", "");
    const point = (unsigned.indexOf(".") < 0 ? unsigned.length : unsigned.indexOf(".")) + Number(exponent);
    const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
    return (negative ? "-" : "") + expanded;
  }
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => {
      const encoder = new TextEncoder();
      const a = encoder.encode(left), b = encoder.encode(right);
      if (a.length !== b.length) return a.length - b.length;
      for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] - b[index];
      return 0;
    });
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}: ${jsonbText(entry)}`).join(", ")}}`;
}

export function canonicalJsonb(value: unknown): string {
  return jsonbText(value);
}

export async function sha256Jsonb(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJsonb(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function makeIdempotencyKey(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}
