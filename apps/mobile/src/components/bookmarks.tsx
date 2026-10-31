import { useContext, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { type BookmarkDto, BOOKMARK_NOTE_MAX, BOOKMARK_NUDGE_SEC, clock } from "@murmur/shared/client";
import { deleteBookmark, updateBookmark } from "@/lib/bookmarks";
import { jumpTo } from "@/player/engine";
import { fonts, useTheme } from "@/theme";
import { PencilIcon, PlayIcon } from "./icons";
import { ConfirmSheet, Sheet } from "./sheet";
import { Button, Field, IconButton, InSheet, Text } from "./ui";

/** Plays a bookmark from a page, in the full player, where the Go back card shows. */
export function openBookmark(b: BookmarkDto) {
  void jumpTo(b, b.positionSec).then(() => router.push("/player"));
}

/** The bookmark rows, the same on books and podcasts: the time, then a chapter and a note if there are any. */
export function BookmarkRows({ bookmarks, onJump }: { bookmarks: BookmarkDto[]; onJump: (b: BookmarkDto) => void }) {
  const t = useTheme();
  const inSheet = useContext(InSheet);
  const [editing, setEditing] = useState<BookmarkDto | null>(null);
  return (
    <View style={{ paddingHorizontal: inSheet ? 12 : 0 }}>
      {bookmarks.map((b, i) => (
        <View key={b.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, borderBottomWidth: i < bookmarks.length - 1 ? 1 : 0, borderBottomColor: t.line }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Go to ${clock(b.positionSec)}`}
            onPress={() => onJump(b)}
            style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: t.surface2 }}>
              <PlayIcon size={16} color={t.text} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, fontVariant: ["tabular-nums"], color: t.text }}>{clock(b.positionSec)}</Text>
              {b.chapter ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 12, color: t.muted }}>
                  {b.chapter}
                </Text>
              ) : null}
              {b.note ? <Text style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingTop: 4, color: t.text2 }}>{b.note}</Text> : null}
            </View>
          </Pressable>
          <IconButton label={`Edit bookmark at ${clock(b.positionSec)}`} onPress={() => setEditing(b)}>
            <PencilIcon size={20} color={t.muted} />
          </IconButton>
        </View>
      ))}
      <BookmarkNoteSheet bookmark={editing} onClose={() => setEditing(null)} />
    </View>
  );
}

/** Adds or edits a bookmark's note, and moves it a little if it landed in the wrong spot. */
export function BookmarkNoteSheet({ bookmark, onClose }: { bookmark: BookmarkDto | null; onClose: () => void }) {
  // The last one stays drawn while the sheet slides away.
  const [last, setLast] = useState(bookmark);
  if (bookmark && bookmark !== last) setLast(bookmark);
  const shown = bookmark ?? last;
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <Sheet
        open={bookmark !== null}
        onClose={onClose}
        head={
          <View style={{ gap: 2 }}>
            <Text variant="heading">{shown?.note ? "Edit note" : "Add a note"}</Text>
            {shown?.chapter ? (
              <Text variant="small" numberOfLines={1}>
                {shown.chapter}
              </Text>
            ) : null}
          </View>
        }
      >
        {shown ? <NoteForm key={shown.id} bookmark={shown} onClose={onClose} onDelete={() => setDeleting(true)} /> : null}
      </Sheet>
      <ConfirmSheet
        open={deleting}
        title="Delete this bookmark?"
        message="It goes for good, along with its note."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (shown) deleteBookmark(shown);
          onClose();
        }}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}

function NoteForm({ bookmark, onClose, onDelete }: { bookmark: BookmarkDto; onClose: () => void; onDelete: () => void }) {
  const t = useTheme();
  const [position, setPosition] = useState(bookmark.positionSec);
  const [note, setNote] = useState(bookmark.note ?? "");
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 4, gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Button label={`−${BOOKMARK_NUDGE_SEC}s`} kind="secondary" small onPress={() => setPosition((p) => Math.max(0, p - BOOKMARK_NUDGE_SEC))} />
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 22, fontVariant: ["tabular-nums"], color: t.text }}>{clock(position)}</Text>
        <Button label={`+${BOOKMARK_NUDGE_SEC}s`} kind="secondary" small onPress={() => setPosition((p) => p + BOOKMARK_NUDGE_SEC)} />
      </View>
      <Field
        label="Note"
        multiline
        maxLength={BOOKMARK_NOTE_MAX}
        value={note}
        onChangeText={setNote}
        style={{ height: 96, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" }}
      />
      <Button
        label="Save"
        onPress={() => {
          updateBookmark(bookmark, { positionSec: position, note: note.trim() || null });
          onClose();
        }}
      />
      <Pressable accessibilityRole="button" onPress={onDelete} hitSlop={6} style={({ pressed }) => ({ alignSelf: "center", paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.danger }}>Delete bookmark</Text>
      </Pressable>
    </View>
  );
}
