# Library scanning rules

The scanner follows the Audiobookshelf folder layout, so an existing library works without moving files.

**Accepted layouts** (relative to a library folder)

```
Author/Title/book.m4b
Author/Title/01.mp3, 02.mp3, ...
Author/Series/Title/...
Author/Series/Book 3 - Title/...
```

## Rules

1. A **book** is a folder that directly contains audio files (`.m4b`, `.m4a`, `.mp3`, `.flac`, `.ogg`, `.opus`).
2. One `.m4b` file = one book; its embedded chapters are used.
3. Several audio files = one multi-file book, ordered by track tag, then disc tag, then natural filename sort. Each file becomes a chapter unless embedded chapters exist.
4. Path depth 2 (`Author/Title`) = no series; depth 3 (`Author/Series/Title`) = series name from the middle folder.
5. A leading number in the title folder (`Book 3 - Title`, `03. Title`) sets the series position.
6. Cover art: `cover.jpg` or `cover.png` in the folder, then the first image file, then embedded art.
7. Optional `desc.txt` (description) and `reader.txt` (narrator) are read, matching Audiobookshelf.

**Metadata priority:** embedded tags (title, author, narrator, year, description) win over folder names, except that folder names always decide author and series grouping, so one mis-tagged file can't split a series.

**Identity:** a book is keyed by its folder path plus a hash of its file list, so progress survives a rescan and renaming a file inside a book doesn't lose it. Moving a book folder is detected by matching the file hash.

**Scans:** a full scan on startup and on demand from Settings; between scans, a file watcher picks up changes after 30 s of quiet. Network mounts that don't report changes can use polling (`WATCH_POLLING`), and a periodic rescan is the safety net.

---

| [← Architecture](architecture.md) | [Contents](README.md) | [Metadata →](metadata.md) |
| :--- | :---: | ---: |
