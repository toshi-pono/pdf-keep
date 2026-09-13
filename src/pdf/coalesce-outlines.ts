import type { TextAsset, TextRangeRequest } from "../shared/protocol";
interface Mergeable {
  type: string;
  asset: TextAsset;
  range?: TextRangeRequest;
  clip?: unknown;
  reason?: string;
  proofRun?: object;
}
/** Only adjacent failures from the same shaping run may share one native export. */
export function coalesceOutlines<T extends Mergeable>(parts: T[]): T[] {
  const output: T[] = [];
  for (const part of parts) {
    const previous = output[output.length - 1];
    if (
      part.type === "native" &&
      previous?.type === "native" &&
      part.proofRun &&
      previous.proofRun === part.proofRun &&
      part.asset === previous.asset &&
      !part.asset.source?.composition &&
      !part.clip &&
      !previous.clip &&
      part.reason === previous.reason &&
      part.range?.format === "pdf" &&
      previous.range?.format === "pdf" &&
      part.range.key === previous.range.key &&
      previous.range.start !== undefined &&
      part.range.start !== undefined &&
      part.range.end !== undefined &&
      previous.range.end === part.range.start
    ) {
      output[output.length - 1] = {
        ...previous,
        range: { ...previous.range, end: part.range.end },
      };
    } else output.push(part);
  }
  return output;
}
