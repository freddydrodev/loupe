interface Props {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** In-app confirmation modal. Used instead of native dialogs to keep the
 *  Tauri capability set minimal (dialog plugin is reserved for file pickers). */
export function Confirm({ title, body, confirmLabel = "Confirm", danger, onConfirm, onCancel }: Props) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title} style={{ width: "min(440px, 100%)" }}>
        <div className="modal-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{body}</div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
