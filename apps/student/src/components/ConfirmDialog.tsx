import { useEffect, useRef } from 'react';
import type { SessionMode } from '../domain/session';

interface ConfirmDialogProps {
  open: boolean;
  busy: boolean;
  mode: SessionMode;
  openCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  busy,
  mode,
  openCount,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    const previousFocus = document.activeElement;
    // The modal top layer makes the background inert and contains keyboard focus.
    dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="submit-title"
      aria-describedby="submit-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <span className="eyebrow">
        {mode === 'exam'
          ? 'KLASSENARBEIT'
          : mode === 'error_training'
            ? 'FEHLERTRAINING'
            : 'LERNRUNDE'}
      </span>
      <h2 id="submit-title">Bereit für dein Ergebnis?</h2>
      <p id="submit-description">
        {openCount} Aufgaben sind noch offen. Nach der Abgabe kannst du alle Lösungen ansehen.
      </p>
      <div className="dialog-actions">
        <button
          className="button secondary"
          type="button"
          autoFocus
          onClick={onCancel}
          disabled={busy}
        >
          Weiterarbeiten
        </button>
        <button className="button primary" type="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Wird gespeichert …' : 'Jetzt abgeben'}
        </button>
      </div>
    </dialog>
  );
}
