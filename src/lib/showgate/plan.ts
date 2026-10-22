import { randomUUID } from "crypto";
import { RISK_LEVELS, type Risk, type Show } from "./model";

// Validates a submitted performance plan. Returns the clean plan, or an error message.
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length <= max ? v.trim() : null);

export function parsePlan(body: unknown): Pick<Show, "title" | "venue" | "performanceDate" | "summary" | "risks"> | string {
  if (!body || typeof body !== "object") return "Invalid body";
  const b = body as Record<string, unknown>;
  const title = str(b.title, 120);
  const venue = str(b.venue, 120);
  const performanceDate = str(b.performanceDate, 40);
  const summary = str(b.summary, 4000);
  if (!title || !venue || !performanceDate || summary === null) return "Title, venue and date are required";
  if (!Array.isArray(b.risks) || b.risks.length > 40) return "Risks must be a list (max 40)";

  const risks: Risk[] = [];
  for (const r of b.risks as Record<string, unknown>[]) {
    const element = str(r?.element, 300);
    const level = RISK_LEVELS.find((l) => l === r?.level);
    const mitigation = str(r?.mitigation ?? "", 2000);
    const owner = str(r?.owner ?? "", 120);
    if (!element || !level || mitigation === null || owner === null) return "Each risk needs an element and a level";
    risks.push({ id: typeof r.id === "string" && r.id ? r.id.slice(0, 64) : randomUUID(), element, level, mitigation, owner });
  }
  return { title, venue, performanceDate, summary, risks };
}
