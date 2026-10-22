import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import type { Show, StaffRole } from "./model";

// Filesystem store, like the template's vault: survives Next.js dev hot reload. It holds
// ciphertext and signed policy bytes only. Replace with a database for anything real.
const DATA_DIR = join(process.cwd(), "data", "showgate");
mkdirSync(DATA_DIR, { recursive: true });

function read<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, name), "utf-8"));
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown): void {
  const file = join(DATA_DIR, name);
  writeFileSync(file + ".tmp", JSON.stringify(value, null, 2));
  renameSync(file + ".tmp", file);
}

export const shows = {
  all: (): Show[] => read<Show[]>("shows.json", []),
  get: (id: string): Show | undefined => shows.all().find((s) => s.id === id),
  save(show: Show) {
    const list = shows.all();
    const i = list.findIndex((s) => s.id === show.id);
    if (i === -1) list.push(show);
    else list[i] = show;
    write("shows.json", list);
  },
};

export interface StoredPolicy {
  role: StaffRole;
  compartment: string;
  policy: string; // base64 signed RelationshipAttestation:1 policy
  grantedBy: string;
  createdAt: string;
}

export const policies = {
  all: (): StoredPolicy[] => read<StoredPolicy[]>("policies.json", []),
  save(p: StoredPolicy) {
    const list = policies.all().filter((x) => x.role !== p.role);
    list.push(p);
    write("policies.json", list);
  },
};
