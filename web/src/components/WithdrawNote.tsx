// Shown wherever access can be withdrawn. Withdrawal is about the future only, and the
// UI must not suggest otherwise.
export default function WithdrawNote() {
  return (
    <p className="notice notice-info">
      Withdrawing stops future access. It can't undo data someone already viewed or copied.
    </p>
  )
}
