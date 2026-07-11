import type { AdminAction } from "../../core/no-build";
import { validateAction, validateActions } from "../../core/validation";
import { BulkConfirmPage, ConfirmPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { loadValidationWorld } from "./read-model";

// The shared §11 gate for any potentially-stranding mutation (client or build). Returns a Response to
// short-circuit the handler — a 400 (malformed) or the confirm page (needs confirmation, not yet
// given) — or null to proceed. The affected set comes from the SAME pure core as runtime resolution.

export interface StrandingGuardOptions {
  /** The action in operator words for the confirm page, e.g. "Withdraw build 1400 (1.3.1-beta)". */
  subject: string;
  /** Where Cancel returns to — the page the operator acted from. */
  cancelTo: string;
}

export async function guardStranding(
  c: AdminContext,
  action: AdminAction,
  confirmed: boolean,
  postTo: string,
  hidden: Record<string, string>,
  opts: StrandingGuardOptions,
): Promise<Response | null> {
  const { world, installed } = await loadValidationWorld(c.get("deps"));
  const result = validateAction(world, action, installed);
  if (!result.ok) return c.text(result.error, 400);
  if (result.needsConfirm && !confirmed) {
    return c.html(
      renderPage(
        <ConfirmPage
          subject={opts.subject}
          affected={result.affectedEmails}
          postTo={postTo}
          hidden={{ ...hidden, confirm: "true" }}
          cancelTo={opts.cancelTo}
        />,
      ),
    );
  }
  return null;
}

/** §11 gate for a batch applied together (the §13 #3 bulk withdraw). Same contract as guardStranding. */
export async function guardStrandingBatch(
  c: AdminContext,
  actions: AdminAction[],
  confirmed: boolean,
  postTo: string,
  op: string,
  ids: number[],
): Promise<Response | null> {
  const { world, installed } = await loadValidationWorld(c.get("deps"));
  const result = validateActions(world, actions, installed);
  if (!result.ok) return c.text(result.error, 400);
  if (result.needsConfirm && !confirmed) {
    return c.html(
      renderPage(
        <BulkConfirmPage op={op} ids={ids} affected={result.affectedEmails} postTo={postTo} />,
      ),
    );
  }
  return null;
}

/**
 * The affected-users preview for an action that is ALWAYS confirmed (channel delete): the §11 list to
 * embed in the confirm page, or a 400 short-circuit when the action is malformed.
 */
export async function strandingPreview(
  c: AdminContext,
  action: AdminAction,
): Promise<{ ok: true; affected: string[] } | { ok: false; response: Response }> {
  const { world, installed } = await loadValidationWorld(c.get("deps"));
  const result = validateAction(world, action, installed);
  if (!result.ok) return { ok: false, response: c.text(result.error, 400) };
  return { ok: true, affected: result.affectedEmails };
}
