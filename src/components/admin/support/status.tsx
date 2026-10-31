import { Badge } from "@/components/admin/ui";
import type {
  ContactStatus,
  SupportResolution,
  SupportStatus,
  SupportType,
} from "@/server/domain/support-state";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const CONTACT_TONE: Record<ContactStatus, Tone> = {
  new: "warning",
  open: "info",
  closed: "neutral",
};
const CASE_TONE: Record<SupportStatus, Tone> = {
  open: "warning",
  in_progress: "info",
  resolved: "success",
  rejected: "neutral",
};
const RESOLUTION_TONE: Record<SupportResolution, Tone> = {
  refund: "success",
  replacement: "primary",
  rejected: "neutral",
};

export const CASE_STATUS_LABEL: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  rejected: "Rejected",
};
export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  new: "New",
  open: "Open",
  closed: "Closed",
};
export const TYPE_LABEL: Record<SupportType, string> = {
  damaged: "Damaged",
  defective: "Defective",
  wrong: "Wrong item",
  missing: "Missing item",
  other: "Other",
};
export const RESOLUTION_LABEL: Record<SupportResolution, string> = {
  refund: "Refund",
  replacement: "Replacement",
  rejected: "Rejected",
};

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <Badge tone={CONTACT_TONE[status]}>{CONTACT_STATUS_LABEL[status]}</Badge>;
}
export function CaseStatusBadge({ status }: { status: SupportStatus }) {
  return <Badge tone={CASE_TONE[status]}>{CASE_STATUS_LABEL[status]}</Badge>;
}
export function CaseTypeBadge({ type }: { type: SupportType }) {
  return <Badge tone="neutral">{TYPE_LABEL[type]}</Badge>;
}
export function ResolutionBadge({ resolution }: { resolution: SupportResolution }) {
  return <Badge tone={RESOLUTION_TONE[resolution]}>{RESOLUTION_LABEL[resolution]}</Badge>;
}
