"use client";

import { useEffect, useState } from "react";
import { apiPaths, errorText, type HiddenDto, type HiddenItem, LIBRARY_SECTION_LABELS, type LibrarySection } from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { useHidden } from "../hidden";
import { EmptyState, SectionTitle } from "../ui";

const ORDER: LibrarySection[] = ["books", "music", "watch"];

/** You > Hidden: what you hid, by Library section, each with Unhide. Empty sections are left out. */
export function HiddenList() {
  const [hidden, setHidden] = useState<HiddenDto | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { unhide } = useHidden();
  useEffect(() => {
    api<HiddenDto>(apiPaths.hidden).then(setHidden, (err: unknown) => setFailed(errorText(err)));
  }, []);

  if (failed) return <EmptyState>{failed}</EmptyState>;
  if (!hidden) return null;
  const sections = ORDER.filter((s) => hidden[s].length);
  if (!sections.length) return <EmptyState title="Nothing hidden" />;

  const show = async (section: LibrarySection, item: HiddenItem) => {
    if (await unhide({ kind: item.kind, id: item.id })) {
      setHidden((h) => h && { ...h, [section]: h[section].filter((x) => !(x.kind === item.kind && x.id === item.id)) });
    }
  };
  return (
    <div className="view-fade">
      {sections.map((s, i) => (
        <section key={s} className="section" style={i === 0 ? { marginTop: 0 } : undefined}>
          <SectionTitle title={LIBRARY_SECTION_LABELS[s]} count={hidden[s].length} />
          <div className="list">
            {hidden[s].map((item) => (
              <div key={`${item.kind}-${item.id}`} className="list-row">
                <Cover src={item.image} color={item.color} title={item.title} className={item.kind === "artist" ? "thumb round" : "thumb"} />
                <span className="list-row-main">
                  <span className="list-row-title">{item.title}</span>
                  <span className="list-row-sub">{item.sub}</span>
                </span>
                <button type="button" className="btn btn-small" onClick={() => void show(s, item)}>
                  Unhide
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
