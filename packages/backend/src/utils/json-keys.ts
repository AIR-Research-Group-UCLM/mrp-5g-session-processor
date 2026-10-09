import { z } from "zod";

function collectPropertyNames(node: unknown, names: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectPropertyNames(child, names);
    return;
  }

  const schemaNode = node as Record<string, unknown>;
  if (schemaNode.properties && typeof schemaNode.properties === "object") {
    for (const [name, child] of Object.entries(schemaNode.properties)) {
      names.add(name);
      collectPropertyNames(child, names);
    }
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf", "additionalProperties"]) {
    collectPropertyNames(schemaNode[key], names);
  }
}

function looseKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

/**
 * Builds a function that recursively renames object keys to the property names
 * declared in `schema`, ignoring case and "_"/"-" separators (e.g. "EndTime" or
 * "end_time" → "endTime"). LLMs occasionally emit such variants in a handful of
 * items of a long JSON response, and a strict schema would otherwise reject the
 * whole response. A correctly spelled key always wins over a variant.
 */
export function createKeyNormalizer(schema: z.ZodType): (value: unknown) => unknown {
  const names = new Set<string>();
  collectPropertyNames(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }), names);
  const canonicalByLooseKey = new Map([...names].map((name) => [looseKey(name), name]));

  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const canonical = canonicalByLooseKey.get(looseKey(key)) ?? key;
      if (canonical !== key && canonical in value) continue;
      result[canonical] = normalize(child);
    }
    return result;
  };

  return normalize;
}
