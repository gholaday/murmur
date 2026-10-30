import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import {
  ALBUM_PROVIDER_NAME,
  type AlbumMatchAllDto,
  type AlbumMatchAllField,
  albumCover,
  apiPaths,
  type BulkMatchDto,
  duration,
  errorText,
  type MatchField,
  plural,
} from "@murmur/shared/client";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { CheckIcon, DownIcon } from "./icons";
import { ALBUM_FIELDS, BOOK_FIELDS, lastAlbumFields, lastBookFields, PROVIDER_NAME, ScorePill } from "./match";
import { SmallButton } from "./settings";
import { Sheet } from "./sheet";
import { toast } from "./toast";
import { Bar, Button, Chip, Chips, Text } from "./ui";

// Match all, like the web's: a button over the unmatched books or albums, a sheet to pick the
// fields, the run's progress, and its results to review and apply. The run itself is on the
// server, so leaving the screen doesn't stop it.

const POLL_MS = 1500;
/** Review results this sure start ticked; the rest you tick yourself. */
const PICK_AT = 80;

type Status = "pending" | "review" | "applied" | "none";
type Filter = "review" | "applied" | "none";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "review", label: "To review" },
  { id: "applied", label: "Applied" },
  { id: "none", label: "No match" },
];

/** One book or album in a run, the same shape for both. */
interface Item {
  id: string;
  title: string;
  status: Status;
  mine: string | null;
  color: string | null;
  theirs: string | null;
  /** The result's title, when there is one. */
  found: string | null;
  sub: string | null;
  score: number | null;
  applied: string[];
  changes: { label: string; from: string | null; to: string | null; edited: boolean }[];
  message: string | null;
}

interface Job {
  running: boolean;
  total: number;
  done: number;
  current: string | null;
  items: Item[];
}

interface Kind {
  path: string;
  noun: "book" | "album";
  fields: { field: string; label: string }[];
  defaults: string[];
  last: () => string[] | null;
  note: string;
  ids: "bookIds" | "albumIds";
  id: "bookId" | "albumId";
  toJob: (dto: never) => Job;
}

const label = (fields: Kind["fields"], f: string) => fields.find((x) => x.field === f)?.label ?? f;

const BOOKS: Kind = {
  path: "/api/library/match",
  noun: "book",
  fields: BOOK_FIELDS,
  defaults: ["cover", "author", "narrator", "series", "year", "chapters"] satisfies MatchField[],
  last: lastBookFields,
  note: "Fields you've edited by hand are never changed, and covers only when the new one is bigger.",
  ids: "bookIds",
  id: "bookId",
  toJob: (dto: BulkMatchDto) => ({
    ...dto,
    items: dto.items.map((i) => {
      const c = i.candidate;
      return {
        id: i.bookId,
        title: i.title,
        status: i.status,
        mine: i.coverHash ? apiPaths.coverUrl(i.bookId, i.coverHash, 200) : null,
        color: i.coverColor,
        theirs: c?.coverUrl ?? null,
        found: c?.title ?? null,
        sub: c ? [PROVIDER_NAME[c.provider], c.narrator ? `read by ${c.narrator}` : null, c.durationSec ? duration(c.durationSec) : null].filter(Boolean).join(", ") : null,
        score: c?.score ?? null,
        applied: i.applied.map((f) => label(BOOK_FIELDS, f).toLowerCase()),
        changes: i.changes.map((x) => ({ label: label(BOOK_FIELDS, x.field), from: x.from, to: x.to, edited: x.edited })),
        message: i.message,
      };
    }),
  }),
};

/** Match all never takes songs; those are matched one album at a time. */
const ALBUM_ALL_FIELDS = ALBUM_FIELDS.filter((f) => f.field !== "tracks");

const ALBUMS: Kind = {
  path: "/api/music/match",
  noun: "album",
  fields: ALBUM_ALL_FIELDS,
  defaults: ["cover", "year", "genre"] satisfies AlbumMatchAllField[],
  last: () => lastAlbumFields()?.filter((f) => f !== "tracks") ?? null,
  note: "Covers are only changed when the new one is bigger.",
  ids: "albumIds",
  id: "albumId",
  toJob: (dto: AlbumMatchAllDto) => ({
    ...dto,
    items: dto.items.map((i) => {
      const c = i.candidate;
      return {
        id: i.albumId,
        title: i.title,
        status: i.status,
        mine: albumCover(i.albumId, i.coverHash),
        color: i.coverColor,
        theirs: c?.thumbUrl ?? null,
        found: c?.title ?? null,
        sub: c ? [ALBUM_PROVIDER_NAME[c.provider], c.artist, c.trackCount ? plural(c.trackCount, "song") : null].filter(Boolean).join(", ") : null,
        score: c?.score ?? null,
        applied: i.applied.map((f) => label(ALBUM_FIELDS, f).toLowerCase()),
        changes: i.changes.map((x) => ({ label: label(ALBUM_FIELDS, x.field), from: x.from, to: x.to, edited: false })),
        message: i.message,
      };
    }),
  }),
};

export type MatchAll = ReturnType<typeof useMatchAll>;

/** A run's state and actions, for the pieces below; the screen lays them out so the bar can stick. */
export function useMatchAll(which: "books" | "albums") {
  const kind = which === "books" ? BOOKS : ALBUMS;
  const [job, setJob] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("review");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());

  // New review results that are sure enough start ticked; ones you've seen keep your choice.
  const adopt = useCallback(
    (dto: unknown) => {
      const next = dto ? kind.toJob(dto as never) : null;
      setJob(next);
      if (!next) return;
      const fresh = next.items.filter((i) => i.status === "review" && !seen.current.has(i.id));
      if (fresh.length === 0) return;
      for (const i of fresh) seen.current.add(i.id);
      setPicked((p) => {
        const out = new Set(p);
        for (const i of fresh) if ((i.score ?? 0) >= PICK_AT) out.add(i.id);
        return out;
      });
    },
    [kind],
  );

  useEffect(() => {
    void api<unknown>(kind.path)
      .then(adopt, () => undefined)
      .finally(() => setLoaded(true));
  }, [kind, adopt]);

  // Poll while it runs; when it finishes, fetch everything again so matched ones leave the lists.
  const running = !!job?.running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void api<unknown>(kind.path).then((next) => {
        adopt(next);
        if (!(next as { running?: boolean } | null)?.running) void queryClient.invalidateQueries();
      }, () => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, kind, adopt]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      adopt(await fn());
      if (done) toast.show(done);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = (fields: string[]) => {
    seen.current.clear();
    setPicked(new Set());
    setFilter("review");
    return run(() => api(kind.path, { method: "POST", body: { fields } }));
  };
  const apply = (ids: string[]) =>
    void run(
      () => api(`${kind.path}/apply`, { method: "POST", body: { [kind.ids]: ids } }),
      ids.length === 1 ? "Matched" : `${plural(ids.length, kind.noun)} matched`,
    ).then(() => void queryClient.invalidateQueries());
  const undo = (id: string) =>
    void run(() => api(`${kind.path}/undo`, { method: "POST", body: { [kind.id]: id } }), "Put back").then(() => void queryClient.invalidateQueries());
  const stop = () => void run(() => api(kind.path, { method: "DELETE" }));
  const discard = () => void run(() => api(kind.path, { method: "DELETE" }), "Results discarded");
  const pick = (id: string, on: boolean) =>
    setPicked((p) => {
      const out = new Set(p);
      if (on) out.add(id);
      else out.delete(id);
      return out;
    });

  return { kind, job, loaded, filter, setFilter, picked, pick, busy, start, apply, undo, stop, discard };
}

/** Before a run: how many aren't matched, and Match all, which opens the fields to take. */
export function MatchAllStart({ m, unmatched }: { m: MatchAll; unmatched: number }) {
  const { kind } = m;
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Set<string>>(new Set(kind.defaults));
  if (m.job || unmatched === 0) return null;
  const toggle = (f: string) => {
    const next = new Set(fields);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setFields(next);
  };
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <Text variant="small">{`${plural(unmatched, kind.noun)} not matched`}</Text>
        <SmallButton
          label="Match all"
          primary
          onPress={() => {
            setFields(new Set(kind.last() ?? kind.defaults));
            setOpen(true);
          }}
        />
      </View>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Match ${plural(unmatched, kind.noun)}`}
        foot={
          <Button
            label="Start matching"
            busy={m.busy}
            disabled={fields.size === 0}
            onPress={() => void m.start([...fields]).then((ok) => ok && setOpen(false))}
          />
        }
      >
        <View style={{ paddingHorizontal: 12, gap: 12, paddingBottom: 8 }}>
          <Text variant="small">{`Each ${kind.noun} is searched and its best result shown for you to check. Nothing changes until you apply.`}</Text>
          <Text variant="bodyStrong" style={{ fontSize: 14 }}>
            Fields to take
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {kind.fields.map(({ field, label }) => (
              <Chip key={field} label={label} selected={fields.has(field)} onPress={() => toggle(field)} />
            ))}
          </View>
          <Text variant="small">{kind.note}</Text>
        </View>
      </Sheet>
    </>
  );
}

/** While it runs: how far it's got and Stop. After: how many it matched and Discard. */
export function MatchAllProgress({ m }: { m: MatchAll }) {
  const t = useTheme();
  const { job, kind } = m;
  if (!job) return null;
  if (!job.running) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <Text variant="bodyStrong">{`Matched ${plural(job.total, kind.noun)}`}</Text>
        <LinkButton label="Discard" disabled={m.busy} onPress={m.discard} />
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 16, gap: 10, marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text variant="bodyStrong">{`Matching ${plural(job.total, kind.noun)}`}</Text>
        <Text variant="small">{`${job.done} of ${job.total}`}</Text>
      </View>
      <Bar pct={job.total ? (job.done / job.total) * 100 : 0} height={6} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
          {job.current ? `Now: ${job.current}` : "Starting…"}
        </Text>
        <LinkButton label="Stop" disabled={m.busy} onPress={m.stop} />
      </View>
    </View>
  );
}

/** The filter chips and Apply, kept at the top while the results scroll. */
export function MatchAllBar({ m }: { m: MatchAll }) {
  const t = useTheme();
  const { job } = m;
  if (!job) return null;
  const review = job.items.filter((i) => i.status === "review");
  const picked = review.filter((i) => m.picked.has(i.id));
  return (
    <View style={{ backgroundColor: t.bg, paddingVertical: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Chips options={FILTERS} value={m.filter} onPick={m.setFilter} label="Results" />
      {m.filter === "review" && review.length ? (
        <SmallButton
          label={picked.length ? `Apply ${picked.length}` : "Pick some"}
          primary
          disabled={m.busy || picked.length === 0}
          onPress={() => m.apply(picked.map((i) => i.id))}
        />
      ) : null}
    </View>
  );
}

/** The results under the picked filter. Search opens Match for that one. */
export function MatchAllRows({ m, onSearch }: { m: MatchAll; onSearch: (id: string) => void }) {
  const { job, kind } = m;
  if (!job) return null;
  const shown = job.items.filter((i) => i.status === m.filter);
  if (shown.length === 0) {
    return (
      <Text variant="small" style={{ textAlign: "center", paddingVertical: 32 }}>
        {job.running ? "Nothing here yet." : `No ${kind.noun}s under ${FILTERS.find((f) => f.id === m.filter)!.label.toLowerCase()}.`}
      </Text>
    );
  }
  return (
    <View>
      {shown.map((item) => (
        <MatchAllRow
          key={item.id}
          item={item}
          picked={m.picked.has(item.id)}
          busy={m.busy}
          onPick={(on) => m.pick(item.id, on)}
          onUndo={() => m.undo(item.id)}
          onApply={() => m.apply([item.id])}
          onSearch={() => onSearch(item.id)}
        />
      ))}
    </View>
  );
}

function MatchAllRow({
  item,
  picked,
  busy,
  onPick,
  onUndo,
  onApply,
  onSearch,
}: {
  item: Item;
  picked: boolean;
  busy: boolean;
  onPick: (on: boolean) => void;
  onUndo: () => void;
  onApply: () => void;
  onSearch: () => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const review = item.status === "review";
  return (
    <View style={{ paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {review ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`Apply the match for ${item.title}`}
            accessibilityState={{ checked: picked }}
            hitSlop={8}
            onPress={() => onPick(!picked)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              borderWidth: picked ? 0 : 1.5,
              borderColor: t.muted,
              backgroundColor: picked ? t.accent : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {picked ? <CheckIcon size={15} color={t.onAccent} /> : null}
          </Pressable>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Cover path={item.mine} title={item.title} color={item.color} size={44} radius={6} />
          {item.found !== null ? (
            <>
              <Text variant="small">→</Text>
              <Cover path={item.theirs} title={item.found} size={44} radius={6} />
            </>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
            {item.found ?? item.title}
          </Text>
          {item.found !== null && item.found !== item.title ? (
            <Text variant="small" numberOfLines={1}>
              {`Yours: ${item.title}`}
            </Text>
          ) : null}
          {item.sub ? (
            <Text variant="small" numberOfLines={1}>
              {item.sub}
            </Text>
          ) : null}
          {item.status === "applied" ? (
            <Text variant="small" numberOfLines={2}>
              {item.applied.length ? `Changed ${item.applied.join(", ")}` : "Matched, nothing needed changing"}
            </Text>
          ) : null}
          {item.message ? (
            <Text variant="small" style={{ color: t.danger }}>
              {item.message}
            </Text>
          ) : null}
        </View>
        {item.score !== null ? <ScorePill score={item.score} /> : null}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: review ? 32 : 0 }}>
        {/* A result can be opened to see what it changes; one with no result has nothing to show. */}
        {item.found !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen(!open)}
            hitSlop={6}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, marginRight: "auto", opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.muted }}>Changes</Text>
            <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
              <DownIcon size={16} color={t.muted} />
            </View>
          </Pressable>
        ) : (
          <View style={{ marginRight: "auto" }} />
        )}
        {item.status === "applied" ? (
          <SmallButton label="Undo" disabled={busy} onPress={onUndo} />
        ) : (
          <>
            <SmallButton label={item.status === "none" ? "Search" : "Search again"} onPress={onSearch} />
            {review ? <SmallButton label="Apply" primary disabled={busy} onPress={onApply} /> : null}
          </>
        )}
      </View>

      {open && item.found !== null ? <Changes item={item} indent={review} /> : null}
    </View>
  );
}

/** Each field the result changes, from what it has now to what it would get. */
function Changes({ item, indent }: { item: Item; indent: boolean }) {
  const t = useTheme();
  if (item.changes.length === 0) {
    return (
      <Text variant="small" style={{ paddingLeft: indent ? 32 : 0 }}>
        Nothing would change.
      </Text>
    );
  }
  return (
    <View style={{ gap: 6, paddingLeft: indent ? 32 : 0 }}>
      {item.changes.map((x) => (
        <View key={x.label} style={{ flexDirection: "row", gap: 10 }}>
          <Text variant="small" style={{ width: 84, fontFamily: fonts.bold }}>
            {x.label}
          </Text>
          {x.edited ? (
            <Text variant="small" style={{ flex: 1 }}>
              Kept, you edited it
            </Text>
          ) : (
            <Text variant="small" numberOfLines={3} style={{ flex: 1 }}>
              <Text variant="small" style={{ textDecorationLine: "line-through", color: t.faint }}>
                {x.from ?? "None"}
              </Text>
              {"  →  "}
              <Text variant="small" style={{ color: t.text }}>
                {x.to ?? "None"}
              </Text>
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function LinkButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} hitSlop={8} style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.accent }}>{label}</Text>
    </Pressable>
  );
}
