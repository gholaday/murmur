/**
 * Placeholders shown while a page loads on the server (see each route's loading.tsx).
 * They follow the real layouts so nothing jumps when the content fades in. Text tabs load as
 * short bars on a hairline (Tabs), never as pills.
 */

import { LibraryTitle } from "./library/library-title";

const Line = ({ width, height }: { width: number | string; height?: number }) => (
  <div className="skel skel-line" style={{ width, height }} />
);

/** A row of text tabs while it loads. */
function Tabs({ widths }: { widths: number[] }) {
  return (
    <div className="skel-tabs">
      {widths.map((w, i) => (
        <Line key={i} width={w} height={14} />
      ))}
    </div>
  );
}

/** A section's title, then one sideways row of cards. */
function Shelf({ title }: { title: number }) {
  return (
    <section className="section">
      <Line width={title} height={16} />
      <div className="shelf" style={{ overflow: "hidden" }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card">
            <div className="skel skel-cover" />
            <Line width="80%" />
            <Line width="55%" height={10} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div className="list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="list-row">
          <div className="skel" style={{ width: 48, height: 48, flexShrink: 0 }} />
          <div className="list-row-main" style={{ gap: 8 }}>
            <Line width="30%" height={10} />
            <Line width={i % 2 ? "70%" : "85%"} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Head({ title }: { title: string }) {
  return (
    <div className="page-head">
      <h1 className="page-title">{title}</h1>
    </div>
  );
}

/** Up Next queue rows: thumb, three text lines, then the play, remove and drag buttons. */
export function QueueRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="list" aria-busy="true" aria-label="Loading the queue">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="queue-row">
          <div className="skel thumb" />
          <div className="list-row-main" style={{ gap: 6 }}>
            <Line width="28%" height={9} />
            <Line width={i % 2 ? "62%" : "78%"} />
            <Line width="38%" height={10} />
          </div>
          {[0, 1, 2].map((b) => (
            <div key={b} style={{ width: 44, height: 44, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <div className="skel" style={{ width: 18, height: 18, borderRadius: 9 }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Books home: the section titles, the tabs, then shelves of cards. */
export function LibrarySkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading library">
      <div className="library-head">
        <div className="page-head">
          <LibraryTitle current="books" />
        </div>
        <Tabs widths={[44, 56, 46, 60]} />
      </div>
      <div style={{ marginTop: 16 }}>
        <Shelf title={150} />
        <Shelf title={110} />
      </div>
    </div>
  );
}

export function PodcastsSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading podcasts">
      <div className="sticky-head">
        <Head title="Podcasts" />
        <Tabs widths={[44, 50, 52]} />
      </div>
      <section className="section">
        <Line width={170} height={16} />
        <div className="row-scroll" style={{ overflow: "hidden" }}>
          {[0, 1].map((i) => (
            <div key={i} className="skel" style={{ width: 290, height: 132, borderRadius: 14, flexShrink: 0 }} />
          ))}
        </div>
      </section>
      <section className="section">
        <Line width={140} height={16} />
        <Rows count={6} />
      </section>
    </div>
  );
}

/** You as it lays out: the stats card, the Settings heading and tabs, then flat rows under a label. */
export function SettingsSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading settings">
      <Head title="You" />
      <section className="section">
        <div className="skel" style={{ height: 200, borderRadius: 14 }} />
      </section>
      <section className="section">
        <Line width={110} height={22} />
        <Tabs widths={[64, 92, 72, 68]} />
      </section>
      {[2, 2].map((rows, s) => (
        <div key={s} className="set-group" style={{ marginTop: s ? 36 : 20 }}>
          <Line width={70} height={11} />
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="setting">
              <Line width={i % 2 ? 90 : 120} />
              <Line width={70} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Music home: the section titles, the tabs, a shelf, a few song rows, another shelf. */
export function MusicSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading music">
      <div className="library-head">
        <div className="page-head">
          <LibraryTitle current="music" />
        </div>
        <Tabs widths={[44, 40, 64, 52, 48]} />
      </div>
      <div style={{ marginTop: 16 }}>
        <Shelf title={120} />
        <section className="section">
          <Line width={100} height={16} />
          <Rows count={3} />
        </section>
      </div>
    </div>
  );
}

/**
 * A detail page while it loads: back row, then the cover beside its title (album, playlist, podcast)
 * or above it on phones, or a round photo (artist), then the Play button, or a podcast's
 * description and tabs, and rows.
 */
export function DetailSkeleton({ kind }: { kind: "book" | "album" | "video" | "artist" | "podcast" }) {
  const back = (
    <div className="hero-bar">
      <div style={{ width: 44, height: 44, display: "grid", placeItems: "center" }}>
        <div className="skel" style={{ width: 22, height: 22, borderRadius: 11 }} />
      </div>
    </div>
  );
  const lines = (
    <>
      <Line width={kind === "artist" ? "70%" : 220} height={20} />
      <Line width={kind === "artist" ? "45%" : 140} />
    </>
  );
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {back}
      {kind === "artist" ? (
        <div className="artist-head">
          <div className="skel" style={{ width: 96, height: 96, borderRadius: "50%", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>{lines}</div>
        </div>
      ) : (
        <div className="book-hero">
          <div
            className={kind === "video" ? "skel cover poster" : "skel cover"}
            style={{ aspectRatio: kind === "video" ? "2 / 3" : "1 / 1" }}
          />
          <div className="skel-hero-text">{lines}</div>
        </div>
      )}
      {kind === "podcast" ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            <Line width="90%" />
            <Line width="60%" />
          </div>
          <div style={{ marginTop: 20 }}>
            <Tabs widths={[66, 64, 62]} />
          </div>
        </>
      ) : kind === "artist" ? null : (
        <div className="actions">
          <div className="skel btn-big" />
        </div>
      )}
      <section className="section">
        <Rows count={5} />
      </section>
    </div>
  );
}

/** Match and photo results while a search runs: candidate cards with a cover and three lines. */
export function ResultsSkeleton({ round }: { round?: boolean }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Searching" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="candidate">
          <div className="skel" style={{ width: 64, height: 64, flexShrink: 0, borderRadius: round ? "50%" : 6 }} />
          <div className="candidate-main" style={{ gap: 8 }}>
            <Line width={i % 2 ? "55%" : "70%"} />
            <Line width="40%" height={10} />
            <Line width="60%" height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A sheet's rows while they load, like Add to playlist's playlists. */
export function SheetRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column" }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48 }}>
          <Line width={i % 2 ? "45%" : "60%"} />
          <Line width={52} height={10} />
        </div>
      ))}
    </div>
  );
}
