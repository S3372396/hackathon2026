import { STATUS_LABEL } from '../lib/shares.ts'
import type { ShareStatus } from '../lib/shares.ts'

const ICON: Record<ShareStatus, string> = {
  active: '●',
  withdrawn: '✕',
  expired: '○',
}

// Status is always text first; the icon and colour only reinforce it.
export default function StatusBadge({ status }: { status: ShareStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span aria-hidden="true">{ICON[status]}</span> {STATUS_LABEL[status]}
    </span>
  )
}
