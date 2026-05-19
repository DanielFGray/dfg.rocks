export type TipTapAttributes = Record<string, unknown>;

export interface TipTapNode {
  type: string;
  attrs?: TipTapAttributes;
  content?: TipTapNode[];
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTipTapNode(value: unknown): value is TipTapNode {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.attrs !== undefined && !isRecord(value.attrs)) {
    return false;
  }

  if (value.content !== undefined && !Array.isArray(value.content)) {
    return false;
  }

  return true;
}
