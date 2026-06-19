interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}

/** Accessible toggle built on a visually-hidden checkbox. */
export function Switch({ checked, onChange, label, hint }: SwitchProps) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span className="track" aria-hidden="true" />
      <span style={{ display: "grid", gap: 2 }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
    </label>
  );
}
