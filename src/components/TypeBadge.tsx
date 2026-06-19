import { typeStyle } from "../lib/pgtypes";

/** A colored glyph + type label. `compact` shows only the glyph (grid headers). */
export function TypeBadge({ dataType, compact }: { dataType: string; compact?: boolean }) {
  const style = typeStyle(dataType);
  return (
    <span className="type-badge" style={{ color: style.colorVar }} title={dataType}>
      <span className="type-glyph mono" aria-hidden="true">
        {style.glyph}
      </span>
      {!compact && <span className="type-label mono">{dataType}</span>}
    </span>
  );
}
