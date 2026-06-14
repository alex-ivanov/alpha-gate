import type { Palette } from "./colors";

// A pure box-drawing table renderer. Column widths are measured on PLAIN text and the cell is padded
// BEFORE any color style is applied, so ANSI codes never throw the alignment off. (Our cell text is
// all single-width — box chars, ✓/✗/·, …, ASCII — so String.length is the right measure.)

export interface Cell {
  text: string;
  /** Applied after padding (e.g. palette.green); alignment is preserved. */
  style?: (s: string) => string;
}

export interface TableOptions {
  head?: string[];
}

export function renderTable(rows: Cell[][], palette: Palette, options: TableOptions = {}): string {
  const cols = rows.reduce((max, row) => Math.max(max, row.length), options.head?.length ?? 0);
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let width = options.head?.[c]?.length ?? 0;
    for (const row of rows) width = Math.max(width, row[c]?.text.length ?? 0);
    widths.push(width);
  }

  const bar = (left: string, mid: string, right: string): string =>
    palette.dim(left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right);

  const sep = palette.dim("│");
  const renderRow = (cells: Cell[]): string => {
    const inner = widths
      .map((w, i) => {
        const cell = cells[i] ?? { text: "" };
        const padded = ` ${cell.text}${" ".repeat(w - cell.text.length)} `;
        return cell.style ? cell.style(padded) : padded;
      })
      .join(sep);
    return `${sep}${inner}${sep}`;
  };

  const lines = [bar("┌", "┬", "┐")];
  if (options.head) {
    lines.push(renderRow(options.head.map((h) => ({ text: h, style: palette.bold }))));
    lines.push(bar("├", "┼", "┤"));
  }
  for (const row of rows) lines.push(renderRow(row));
  lines.push(bar("└", "┴", "┘"));
  return lines.join("\n");
}
