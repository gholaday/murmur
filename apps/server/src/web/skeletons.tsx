/**
 * Placeholders shown while a page loads on the server (see each route's loading.tsx).
 * They follow the real layouts so nothing jumps when the content fades in.
 */

const Line = ({ width, height }: { width: number | string; height?: number }) => (
  <div className="skel skel-line" style={{ width, height }} />
);

function CardGrid({ count }: { count: number }) {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card">
          <div className="skel skel-cover" />
          <Line width="80%" />
          <Line width="55%" height={10} />
        </div>
      ))}
    </div>
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
    <div className="list" aria-busy="true" aria-label="Loading Up Next">
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

export function LibrarySkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading library">
      <Head title="Books" />
      <div className="chips">
        {[76, 84, 72, 84].map((w, i) => (
          <div key={i} className="skel skel-pill" style={{ width: w }} />
        ))}
      </div>
      <section className="section">
        <Line width={140} height={16} />
        <CardGrid count={12} />
      </section>
    </div>
  );
}

export function PodcastsSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading podcasts">
      <Head title="Podcasts" />
      <section className="section">
        <Line width={130} height={16} />
        <Rows count={4} />
      </section>
      <section className="section">
        <Line width={120} height={16} />
        <CardGrid count={6} />
      </section>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading settings">
      <Head title="You" />
      <div className="skel" style={{ height: 48, borderRadius: 12 }} />
      {[2, 2, 3].map((rows, s) => (
        <section key={s} className="section">
          <Line width={110} height={16} />
          <div className="card-box">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="setting">
                <Line width={i % 2 ? 90 : 120} />
                <div className="skel skel-pill" style={{ width: 120, height: 32 }} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
