import { createContext, useContext } from "react";
import type { Snapshot } from "./types";
export type PilotContext = {
  state: Snapshot;
  refresh: () => Promise<void>;
  mutate: (path: string, body?: unknown) => Promise<void>;
  run: (path: string, body?: unknown, message?: string) => Promise<void>;
  go: (page: string) => void;
  toast: (message: string) => void;
};
export const Context = createContext<PilotContext | null>(null);
export function usePilot() {
  const context = useContext(Context);
  if (!context) throw new Error("앱 연결 정보가 없습니다.");
  return context;
}
