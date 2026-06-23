import type { ReferencingConstraint } from "../lib/types";
import { onDeleteLabel } from "../lib/relations";

interface Props {
  count: number;
  refs: ReferencingConstraint[];
  loadingRefs: boolean;
}

/** Severity ordering so the riskiest constraints surface first. */
function severity(action: ReferencingConstraint["onDelete"]): number {
  switch (action) {
    case "restrict":
    case "noAction":
      return 0;
    case "cascade":
      return 1;
    default:
      return 2; // setNull / setDefault
  }
}

function effect(c: ReferencingConstraint): string {
  switch (c.onDelete) {
    case "restrict":
    case "noAction":
      return "deletion will fail if dependent rows exist";
    case "cascade":
      return "dependent rows will also be deleted";
    case "setNull":
      return "referencing columns will be set to NULL";
    case "setDefault":
      return "referencing columns will be set to their default";
  }
}

/** Body for the delete confirmation modal: how many rows, and which inbound
 *  foreign keys reference this table along with their ON DELETE behavior. */
export function DeleteConfirmBody({ count, refs, loadingRefs }: Props) {
  const sorted = [...refs].sort((a, b) => severity(a.onDelete) - severity(b.onDelete));

  return (
    <div className="del-confirm">
      <p>
        Delete <strong>{count}</strong> {count === 1 ? "row" : "rows"}? This cannot be undone.
      </p>

      {loadingRefs ? (
        <p className="muted">Checking dependent tables…</p>
      ) : sorted.length === 0 ? (
        <p className="muted">No other tables reference this one.</p>
      ) : (
        <>
          <p className="muted">Tables that reference this one:</p>
          <ul className="del-refs">
            {sorted.map((c) => (
              <li key={c.constraintName} className={`del-ref del-ref-${c.onDelete}`}>
                <span className="mono">
                  {c.referencingSchema === "public"
                    ? c.referencingTable
                    : `${c.referencingSchema}.${c.referencingTable}`}
                  {" ("}
                  {c.referencingColumns.join(", ")}
                  {")"}
                </span>
                <span className="del-ref-action">ON DELETE {onDeleteLabel(c.onDelete)}</span>
                <span className="del-ref-effect">— {effect(c)}</span>
                {c.prismaOnDelete &&
                  c.prismaOnDelete.toLowerCase() !== onDeleteLabel(c.onDelete).replace(/\s/g, "").toLowerCase() && (
                    <span className="del-ref-prisma">Prisma: {c.prismaOnDelete}</span>
                  )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
