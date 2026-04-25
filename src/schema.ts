export function inferSchema(value: unknown): object {
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "string") return { type: "string" };
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: {} };
    const itemSchemas = value.map(inferSchema).filter(s => (s as any).type !== "null");
    if (itemSchemas.length === 0) return { type: "array", items: { type: "null" } };
    const merged = itemSchemas.reduce(mergeSchemas);
    return { type: "array", items: merged };
  }
  if (typeof value === "object") {
    const properties: Record<string, object> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      properties[k] = inferSchema(v);
      required.push(k);
    }
    return { type: "object", properties, required };
  }
  return {};
}

function mergeObjectSchemas(a: any, b: any): object {
  const properties: Record<string, object> = { ...a.properties };
  const aReq = new Set<string>(a.required ?? []);
  const bReq = new Set<string>(b.required ?? []);

  for (const [k, v] of Object.entries(b.properties ?? {})) {
    properties[k] = k in properties
      ? mergeSchemas(properties[k] as object, v as object)
      : (v as object);
  }

  const required = [...aReq].filter(k => bReq.has(k));
  return { type: "object", properties, required };
}

function mergeSchemas(a: object, b: object): object {
  const ta = (a as any).type;
  const tb = (b as any).type;

  if (ta === "object" && tb === "object") return mergeObjectSchemas(a, b);

  // Flatten existing anyOf to avoid nesting
  const variantsA: object[] = (a as any).anyOf ?? [a];
  const variantsB: object[] = (b as any).anyOf ?? [b];

  const merged = [...variantsA];
  for (const v of variantsB) {
    const vt = (v as any).type;
    if (!merged.some(m => (m as any).type === vt)) merged.push(v);
  }

  return merged.length === 1 ? merged[0] : { anyOf: merged };
}

export function toJsonSchema(data: unknown): string {
  return JSON.stringify(
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "Generated schema for Root",
      ...inferSchema(data),
    },
    null,
    2
  );
}
