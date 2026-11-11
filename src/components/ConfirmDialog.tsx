import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The native modal dialog: the browser traps focus, makes the page behind it inert, closes on
 * Escape and returns focus to the opener. The least destructive button gets focus first.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel, busy = false, onConfirm, onClose }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      <div className="dialog__body">{children}</div>
      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onClose} autoFocus>
          {cancelLabel}
        </button>
        <button type="button" className="button button--danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {busy ? 'Cancelling…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
