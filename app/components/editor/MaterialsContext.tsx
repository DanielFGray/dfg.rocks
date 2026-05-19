import { createContext, useContext } from "react";
import type { Material } from "../../lib/types.js";

export const MaterialsContext = createContext<Map<string, Material>>(new Map());

export function useMaterial(id: string): Material | undefined {
  const map = useContext(MaterialsContext);
  return map.get(id);
}
