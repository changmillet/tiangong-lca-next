export type MaintainedPatchEntry = { package: string; path: string; sha256: string };
export function readMaintainedPatches(root: string): {
  entries: MaintainedPatchEntry[];
  files: { path: string; raw: Buffer }[];
  sha256: string;
};
export function verifyMaintainedPatches(
  root: string,
  entries: MaintainedPatchEntry[],
  sha256: string,
): ReturnType<typeof readMaintainedPatches>;
