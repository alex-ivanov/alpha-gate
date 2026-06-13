import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { insert as insertClient } from "../../../src/db/clients";
import {
  assignUser,
  create,
  deleteById,
  getByName,
  list,
  listUserStreams,
  streamIdsForClient,
  unassignUser,
} from "../../../src/db/streams";
import { cleanDb } from "../../support/db";

const db = env.DB;

beforeEach(cleanDb);

describe("streams db", () => {
  it("creates, lists, looks up by name, and deletes", async () => {
    const stable = await create(db, "stable");
    await create(db, "beta");

    expect((await list(db)).map((s) => s.name)).toEqual(["stable", "beta"]);
    expect((await getByName(db, "beta"))?.name).toBe("beta");

    await deleteById(db, stable.id);
    expect((await list(db)).map((s) => s.name)).toEqual(["beta"]);
  });

  it("assigns and unassigns users, idempotently, and reports the per-client slice", async () => {
    const client = await insertClient(db, { email: "a@example.test", token: "TOK_A" });
    const stable = await create(db, "stable");
    const beta = await create(db, "beta");

    await assignUser(db, client.id, stable.id);
    await assignUser(db, client.id, stable.id); // OR IGNORE — no duplicate
    await assignUser(db, client.id, beta.id);

    expect((await streamIdsForClient(db, client.id)).sort()).toEqual([stable.id, beta.id].sort());
    expect(await listUserStreams(db)).toEqual(
      expect.arrayContaining([
        { clientId: client.id, streamId: stable.id },
        { clientId: client.id, streamId: beta.id },
      ]),
    );

    await unassignUser(db, client.id, stable.id);
    expect(await streamIdsForClient(db, client.id)).toEqual([beta.id]);
  });
});
