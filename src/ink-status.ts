const recordingMarks = ["●", "◐", "◓", "◑"];

export function statusMark(recording: boolean, frame: number): string {
  return recording ? recordingMarks[frame % recordingMarks.length] : "◌";
}
