import { sliceByDisplayPosition, stripAnsi } from "../utils/ansi-parser";
import type { VisibleRow } from "./log-buffer";

/**
 * Extract selected text from visible rows using visual (display) coordinates.
 * Handles ANSI escape codes by slicing based on visual position, not string index.
 */
export function extractSelectedText(
  rows: VisibleRow[],
  anchorX: number,
  anchorY: number,
  focusX: number,
  focusY: number,
): string {
  if (anchorX === focusX && anchorY === focusY) return "";

  let startY = anchorY,
    startX = anchorX,
    endY = focusY,
    endX = focusX;
  if (startY > endY || (startY === endY && startX > endX)) {
    [startY, endY] = [endY, startY];
    [startX, endX] = [endX, startX];
  }

  const lines: string[] = [];
  for (
    let y = Math.max(0, startY);
    y <= Math.min(rows.length - 1, endY);
    y++
  ) {
    const text = rows[y].text;

    if (y === startY && y === endY) {
      lines.push(
        sliceByDisplayPosition(text, Math.max(0, startX), endX + 1),
      );
    } else if (y === startY) {
      lines.push(sliceByDisplayPosition(text, Math.max(0, startX)));
    } else if (y === endY) {
      lines.push(sliceByDisplayPosition(text, 0, endX + 1));
    } else {
      lines.push(stripAnsi(text));
    }
  }

  return lines.join("\n");
}
