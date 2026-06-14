import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

// The filesystem seam — rendering configs, the state ledger, and the temp secrets file. Behind an
// interface so the command orchestration is tested against an in-memory fake. read() returns null for
// a missing file (callers treat that as "first run") rather than throwing.

export interface FileSystem {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export function createFileSystem(): FileSystem {
  return {
    async read(path) {
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async write(path, data) {
      await writeFile(path, data, "utf8");
    },
    async mkdirp(path) {
      await mkdir(path, { recursive: true });
    },
    async remove(path) {
      await rm(path, { force: true });
    },
  };
}

export function createFakeFileSystem(
  seed: Record<string, string> = {},
): FileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, data) => {
      files.set(path, data);
      return Promise.resolve();
    },
    mkdirp: () => Promise.resolve(),
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
  };
}
