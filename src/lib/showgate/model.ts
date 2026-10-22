// ShowGate domain model. Shared by the browser and the API routes, so nothing here touches fs.

export const STAFF_ROLES = ["sg-production", "sg-safety", "sg-venue"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<StaffRole, string> = {
  "sg-production": "Production",
  "sg-safety": "Safety",
  "sg-venue": "Venue",
};

// Each role owns one compartment of sensitive notes. The compartment id is the record id of a
// RelationshipAttestation:1 policy whose subject is the role, so the Tide network (not this
// server) decides who can decrypt it. It is also the ONLY tag on every encrypted note.
export const COMPARTMENT_FOR: Record<StaffRole, string> = {
  "sg-production": "showgate-notes-production",
  "sg-safety": "showgate-notes-safety",
  "sg-venue": "showgate-notes-venue",
};

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface Risk {
  id: string;
  element: string; // e.g. "Pyrotechnic flash pots, Act 2"
  level: RiskLevel;
  mitigation: string;
  owner: string;
}

export interface Note {
  id: string;
  role: StaffRole; // which compartment it was encrypted into
  ciphertext: string;
  author: string;
  createdAt: string;
}

export interface Approval {
  role: StaffRole;
  userId: string;
  username: string;
  at: string;
  planVersion: number;
  rulesVersion: number;
}

export interface Show {
  id: string;
  title: string;
  venue: string;
  performanceDate: string;
  summary: string;
  risks: Risk[];
  notes: Note[];
  approvals: Approval[];
  planVersion: number; // bumped on every edit; approvals for older versions stop counting
  submittedBy: string;
  createdAt: string;
  updatedAt: string;
}

// The approval rules live in a TideCloak client mapper, so they arrive inside the signed access
// token. Changing them is a PROTOCOL_MAPPER change request that needs the admin quorum.
export interface ApprovalRules {
  version: number;
  requiredApprovals: StaffRole[];
  mitigationRequiredFor: RiskLevel[];
}

export function parseRules(claim: unknown): ApprovalRules | null {
  const raw = typeof claim === "string" ? safeJson(claim) : claim;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const required = Array.isArray(r.requiredApprovals)
    ? r.requiredApprovals.filter((x): x is StaffRole => STAFF_ROLES.includes(x as StaffRole))
    : [];
  const mitigation = Array.isArray(r.mitigationRequiredFor)
    ? r.mitigationRequiredFor.filter((x): x is RiskLevel => RISK_LEVELS.includes(x as RiskLevel))
    : [];
  // Fail closed: a rule set that requires nobody would approve every show.
  if (typeof r.version !== "number" || required.length === 0) return null;
  return { version: r.version, requiredApprovals: required, mitigationRequiredFor: mitigation };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function unmitigatedRisks(show: Show, rules: ApprovalRules): Risk[] {
  return show.risks.filter(
    (r) => rules.mitigationRequiredFor.includes(r.level) && (!r.mitigation.trim() || !r.owner.trim()),
  );
}

export interface ShowStatus {
  approved: boolean;
  // Approvals that count: current plan version, a required role, one role per person.
  counted: Approval[];
  missingRoles: StaffRole[];
  blockers: string[];
}

export function showStatus(show: Show, rules: ApprovalRules | null): ShowStatus {
  if (!rules) {
    return { approved: false, counted: [], missingRoles: [], blockers: ["Approval rules are missing from your session."] };
  }
  const counted: Approval[] = [];
  const people = new Set<string>();
  for (const a of show.approvals) {
    if (a.planVersion !== show.planVersion) continue;
    if (!rules.requiredApprovals.includes(a.role)) continue;
    if (people.has(a.userId) || counted.some((c) => c.role === a.role)) continue;
    people.add(a.userId);
    counted.push(a);
  }
  const missingRoles = rules.requiredApprovals.filter((r) => !counted.some((c) => c.role === r));
  const blockers: string[] = [];
  const open = unmitigatedRisks(show, rules);
  if (open.length) blockers.push(`${open.length} risk(s) need a mitigation and an owner.`);
  if (missingRoles.length) blockers.push(`Waiting on: ${missingRoles.map((r) => ROLE_LABEL[r]).join(", ")}.`);
  return { approved: blockers.length === 0, counted, missingRoles, blockers };
}
