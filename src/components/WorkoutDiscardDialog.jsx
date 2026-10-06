// WorkoutDiscardDialog.jsx — the single discard confirmation for workout
// exit. Both Standard and Guided runners share it, so the destructive
// contract (explicit copy, safe action focused, exactly one confirmation)
// cannot drift between modes. It is presentation only: confirming calls back
// into the caller's already-confirmed discard operation.

import { ConfirmDialog } from './Dialog.jsx';

export default function WorkoutDiscardDialog({ completedSets, totalSets, onKeepEditing, onDiscard }){
  return (
    <ConfirmDialog
      title="Discard this workout?"
      description={`${completedSets}/${totalSets} sets logged. Discarding cannot be undone.`}
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      destructive
      onConfirm={onDiscard}
      onCancel={onKeepEditing}
    />
  );
}
