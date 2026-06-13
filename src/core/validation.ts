import { type AdminAction, computeAffectedUsers, type World } from "./no-build";

// §11 — pre-mutation validation. Actions that would strand users are confirmed, not blocked: the
// caller computes the affected set up front, shows it, and proceeds only on confirm. This module also
// guards malformed params defensively, since the action is built from untrusted form/HTTP input.

export type ValidationResult =
  | { ok: false; error: string }
  | { ok: true; needsConfirm: boolean; affectedEmails: string[] };

export function validateAction(
  world: World,
  action: AdminAction,
  installed?: ReadonlyMap<number, number>,
): ValidationResult {
  const guardError = guardAction(action);
  if (guardError !== null) return { ok: false, error: guardError };

  const affectedEmails = computeAffectedUsers(world, action, installed);
  return { ok: true, needsConfirm: affectedEmails.length > 0, affectedEmails };
}

/** Returns an error message if the action's id params are not positive integers, else null. */
function guardAction(action: AdminAction): string | null {
  switch (action.type) {
    case "withdraw-build":
    case "restore-build":
      return isPositiveInt(action.buildId) ? null : "buildId must be a positive integer";
    case "remove-build-from-stream":
      return isPositiveInt(action.buildId) && isPositiveInt(action.streamId)
        ? null
        : "buildId and streamId must be positive integers";
    case "unassign-user-stream":
      return isPositiveInt(action.clientId) && isPositiveInt(action.streamId)
        ? null
        : "clientId and streamId must be positive integers";
    case "pin-client":
      return isPositiveInt(action.clientId) && isPositiveInt(action.buildId)
        ? null
        : "clientId and buildId must be positive integers";
    case "unpin-client":
      return isPositiveInt(action.clientId) ? null : "clientId must be a positive integer";
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
