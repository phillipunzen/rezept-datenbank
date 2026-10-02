import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import type { Locale } from "../translations";
import { recipeMessages } from "./messages";
export function moveItem<T>(items: T[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length)
    return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
export function SortControls({
  index,
  total,
  kind,
  locale,
  move,
  remove,
}: {
  index: number;
  total: number;
  kind: string;
  locale: Locale;
  move: (from: number, to: number) => void;
  remove: () => void;
}) {
  const t = recipeMessages[locale];
  return (
    <div className="sort-controls">
      <button
        type="button"
        className="icon-button drag-handle"
        aria-label={`${kind} ${index + 1} drag`}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(
            "application/x-recipe-row",
            JSON.stringify({ kind, index }),
          );
          event.dataTransfer.effectAllowed = "move";
        }}
      >
        <GripVertical size={17} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`${t.up} ${kind} ${index + 1}`}
        disabled={!index}
        onClick={() => move(index, index - 1)}
      >
        <ArrowUp size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`${t.down} ${kind} ${index + 1}`}
        disabled={index === total - 1}
        onClick={() => move(index, index + 1)}
      >
        <ArrowDown size={16} />
      </button>
      <button
        type="button"
        className="icon-button danger"
        aria-label={`${t.remove} ${kind} ${index + 1}`}
        disabled={total === 1}
        onClick={remove}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
export function dropRow(
  event: React.DragEvent,
  kind: string,
  to: number,
  move: (from: number, to: number) => void,
) {
  event.preventDefault();
  try {
    const data = JSON.parse(
      event.dataTransfer.getData("application/x-recipe-row"),
    ) as { kind?: string; index?: number };
    if (data.kind === kind && typeof data.index === "number")
      move(data.index, to);
  } catch {}
}
