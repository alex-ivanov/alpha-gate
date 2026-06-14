// The deploy CLI's one sanctioned use of Date (allow-listed in biome.json, like src/lib/clock.ts):
// a filesystem-safe UTC stamp for the teardown archive filename, e.g. "20260614T120000Z". Injected as
// a seam so tests pass a fixed value.

export function nowStamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}
