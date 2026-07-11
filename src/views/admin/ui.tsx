import type { FC } from "hono/jsx";
import type { Build } from "../../core/types";
import { formatWhen, type Verdict } from "../../core/verdict";

// Quiet-instrument primitives shared by every admin page: the canonical version lockup, state tags,
// state dots, timestamps, and the verdict rendered in operator words. Pure JSX over props (§23).

/**
 * The one canonical way a build is written anywhere in the back office: `#1500 · v1.2.1` — mono,
 * number carrying the weight. Never a raw DB row id. `href` makes it the link to the build page.
 */
export const Lk: FC<{
  build: Pick<Build, "buildNumber" | "shortVersion">;
  href?: string | undefined;
  /** Muted variant — "nothing will change" (up-to-date verdicts, secondary mentions). */
  dim?: boolean | undefined;
  /** Omit the version half (tight cells, second mentions). */
  short?: boolean | undefined;
}> = ({ build, href, dim, short }) => {
  const body = (
    <>
      <b>#{build.buildNumber}</b>
      {short ? null : <i> · v{build.shortVersion}</i>}
    </>
  );
  const cls = dim ? "lk dim" : "lk";
  return href ? (
    <a class={cls} href={href}>
      {body}
    </a>
  ) : (
    <span class={cls}>{body}</span>
  );
};

/**
 * Exception-only state tag. Healthy states render nothing — silence is the ok state. `crit` is the
 * single filled tag in the system.
 */
export const Tag: FC<{
  kind: "warn" | "mut" | "acc" | "crit";
  label: string;
  title?: string;
}> = ({ kind, label, title }) => (
  <span class={`tag ${kind}`} title={title}>
    {label}
  </span>
);

/** Build state tags for one build — exceptions only (an available, ordinary build shows nothing). */
export const BuildTags: FC<{ build: Build }> = ({ build }) => (
  <>
    {build.status === "withdrawn" ? (
      <Tag kind="mut" label="withdrawn" title="Not offered to anyone; restore to serve it again" />
    ) : null}
    {build.critical ? (
      <Tag kind="crit" label="critical" title="Sparkle treats this update as required" />
    ) : null}
    {build.rollbackTarget ? (
      <Tag kind="acc" label="rollback target" title="Old code republished above the bad build" />
    ) : null}
    {build.hidden ? <Tag kind="mut" label="hidden" title="Hidden from the list only" /> : null}
  </>
);

/** 8px state dot: ok (serving) · warn (faults) · off (serving nothing) · req (requests). */
export const Dot: FC<{ kind: "ok" | "warn" | "off" | "req"; title?: string }> = ({
  kind,
  title,
}) => <span class={`dot ${kind}`} title={title} aria-hidden="true" />;

/** The one timestamp form: `Jul 09 08:30` with the full ISO in the title (and datetime). */
export const When: FC<{ iso: string | null; now: string }> = ({ iso, now }) =>
  iso === null ? (
    <span class="mut">—</span>
  ) : (
    <time class="t" datetime={iso} title={iso}>
      {formatWhen(iso, now)}
    </time>
  );

/**
 * The verdict in operator words — the Users list's "Next check" cell and every detail page's strip.
 * Faults carry the cause; remedies live in the surrounding page (attention list, detail actions).
 */
export const VerdictCell: FC<{ verdict: Verdict }> = ({ verdict }) => {
  switch (verdict.kind) {
    case "offered":
      return (
        <span class="vd">
          gets <Lk build={verdict.build} />
          {verdict.via === "pin" ? (
            <Tag kind="mut" label="pinned" title="The pin decides — channels are ignored" />
          ) : null}
          {verdict.build.critical ? (
            <Tag kind="crit" label="critical" title="Sparkle treats this update as required" />
          ) : null}
        </span>
      );
    case "up-to-date":
      return (
        <span class="vd mut">
          up to date · <Lk build={verdict.build} dim short />
          {verdict.via === "pin" ? (
            <Tag kind="mut" label="pinned" title="Held here by the pin" />
          ) : null}
        </span>
      );
    case "revoked":
      return <span class="vd mut">— not served while revoked</span>;
    case "no-channel":
      return (
        <span class="vd">
          <Tag kind="warn" label="no channel" title="Resolves to nothing — assign a channel" />{" "}
          <span class="mut">assign one to serve them</span>
        </span>
      );
    case "empty-channel":
      return (
        <span class="vd">
          <Tag kind="warn" label="no build" title="Their channels carry no available build" />{" "}
          <span class="mut">their channels serve nothing</span>
        </span>
      );
    case "pin-unavailable":
      return (
        <span class="vd">
          <Tag kind="warn" label="pin serves nothing" title="The pinned build was withdrawn" />{" "}
          <span class="mut">pinned build is withdrawn — unpin or re-pin</span>
        </span>
      );
    case "pin-below-installed":
      return (
        <span class="vd">
          <Tag
            kind="warn"
            label="pin below installed"
            title="Sparkle can't downgrade — the pin serves nothing"
          />{" "}
          <span class="mut">
            pinned <Lk build={verdict.pinned} dim short /> under installed #{verdict.installed}
          </span>
        </span>
      );
    case "stranded":
      return (
        <span class="vd">
          <Tag
            kind="warn"
            label="stranded"
            title="Installed above everything their channels offer"
          />{" "}
          <span class="mut">
            nothing above <b class="num">#{verdict.installed}</b> — roll forward
          </span>
        </span>
      );
  }
};
