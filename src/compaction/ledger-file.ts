import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CarryforwardLedger,
  CarryforwardSnapshot,
} from "./types.js";

interface LedgerFileData {
  note: string;
  anchorMessageId?: string;
  updatedAt: string;
}

export function createFileLedger(path: string): CarryforwardLedger {
  return {
    readSnapshot() {
      if (!existsSync(path)) return null;
      try {
        const parsed = JSON.parse(readFileSync(path, "utf-8")) as LedgerFileData;
        return {
          note: parsed.note,
          anchorMessageId: parsed.anchorMessageId,
        } satisfies CarryforwardSnapshot;
      } catch {
        return null;
      }
    },
    markApplied(snapshot) {
      mkdirSync(dirname(path), { recursive: true });
      const payload: LedgerFileData = {
        note: snapshot.note,
        anchorMessageId: snapshot.anchorMessageId,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(path, JSON.stringify(payload, null, 2));
    },
  };
}
