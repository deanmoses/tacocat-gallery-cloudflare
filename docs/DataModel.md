# The data model

The gallery's tree, the rows that hold it, the rules the database enforces, how an album is read and written, and search. `api/src/db/schema.ts` is the schema, in Drizzle; `shared/src/paths.ts` is the path grammar; `api/src/gallery/` holds the reads, writes and search.

## Paths and items

The gallery is a tree, and a path is a URL:

```text
/                        the root album: the list of years, not a row
/2001/                   a year album
/2001/06-15/             a day album
/2001/06-15/felix        a media item, always in a day album
```

- **An album** has a description, a one-line summary, a published flag, and the media item it shows as its thumbnail, from anywhere in its subtree. A day album can be published only while its year is. A day album's media is in name order, since files are usually named in the order they should show before they are uploaded, until an admin drags it into an order of their own; media added after that goes at the end, in name order, until the next reorder.
- **A media item** is an image or a video. It has the version id of its current file, its size, a video's duration, a title, a description, a set of tags, and the rectangle its thumbnail is cut from. It shows whenever its album does.

An `item` row is identified by `(parent_path, item_name)`, so `felix` in `/2001/06-15/`, and referenced by its integer `id`. A media name is lowercase letters and digits with single underscores between them, and carries no extension: what kind of file the item is, `media_type` and the original's content type say.

## Tables

Cloudflare D1 (SQLite) holds everything but the media files:

- `item`: every album and media item, one row each
- `item_fts` and `item_fts_exact`: the search indexes, stemmed and as typed, built over `item_indexed`, a view of `item` that splits letters from digits in every name and caption and adds the words photo, image and picture to an image's tags and movie, video and clip to a video's
- `upload`: uploads in progress, one row per URL the Worker has handed out
- `upload_error`: errors during async media upload/processing, for the admin UI to show
- `user`: admins
- `passkey`: passkeys for admins
- `invite`: invites for admins to create a passkey
- `spent_challenge`: used login challenges

**Migrations** are written by drizzle-kit from `schema.ts` into `api/migrations/`. The search index, its view and its triggers are raw SQL in a migration, since Drizzle models none of them. Changing the database in `Development.md` has the procedure.

**Read replicas.** Reads go through a D1 session, so the nearest replica can answer. Every write answers with the session's bookmark, as a header and a short-lived cookie, and a read that brings a bookmark back is served by a copy at least that new, so an admin sees their own save from whichever replica answers.

## Reading

The app reads `GET /api/album/2001/06-15/`:

1. The Worker opens a D1 session, so the nearest read replica can answer.
2. It reads the album's row and its children's rows, and nothing else.
3. A guest gets only published albums; an admin gets everything.
4. The rows go out in the record shapes `shared/` defines, which the app parses with the same schemas.

The app works out the previous and next albums from the parent's children, so a read never depends on anything outside the album's own subtree.

The album page's own headers, from `web/static/_headers`, name this request and the parent's as preloads, so the browser sends them as the page arrives rather than after the app's JS has loaded and run; with the zone's Early Hints on, it sends them before the page's body.

## Search

Search is SQLite's FTS5, in the same database. Words and phrases are matched in `item_fts`, the porter stemmer over the unicode61 tokenizer, which folds case and accents; a prefix is matched in `item_fts_exact`, unicode61 alone, since the stemmer would stem the prefix too and `vacati` is no prefix of `vacat`. Triggers keep both in step with `item` by reading the changed row through the view, firing only when a column the view reads changes.

The query syntax is the one the gallery's search has always had, RediSearch's: words anywhere, `"an exact phrase"`, `pre*` for a prefix, `-not this`, `this|that`, `@title:word` or `@title|tags:(some words)` to look in a field, and parentheses to group; the fields are name, title, description, tags and summary. `api/src/gallery/query.ts` compiles it to a tree of FTS5 matches that the search joins in SQL, so that nothing typed is a syntax error, dropping the stop words RediSearch dropped and splitting letters from digits as the index does, so `pat` and `pat1` both find `pat1`. A search that asks for nothing, or only for words to leave out, or names a field the index lacks, or has more than 32 words or parentheses nested more than 8 deep, is refused with a message, which the search page shows. Results come by day, newest first unless asked otherwise, each day's album before its media in album order; guests see published albums and what is in them.

## Writing

Every `POST`, `PUT`, `PATCH` and `DELETE` needs a logged-in admin; one middleware in `api/src/routes/app.ts` refuses the rest.

Publishing `/2001/06-15/` is one statement:

```text
UPDATE item SET published = 1
WHERE  the row is /2001/06-15/
  AND  EXISTS (the year /2001/ is published)
```

If it changed a row, the Worker answers 204 with the bookmark. If it changed nothing, one read of the facts the conditions looked at says why, and the answer is `400 Cannot publish until parent is published`, or a 404 if the album is not there. Every error the Worker sends is `{ "errorMessage": "…" }`.

- Renaming a day album moves the album and its children in one batch, each statement conditional on the rename being possible.
- Deleting a media item deletes its row. The foreign key clears it from any album that showed it; its objects stay in the buckets.
- Reordering a day album is one statement that gives each of its media rows its place in the order the admin saved, looked up by name, and none to media the order leaves out. The album read sorts by name in SQL, which the path index gives for free, and puts the placed media first in the Worker, since a sort in SQL passes every row through a temporary B-tree that D1 counts as reading it again. `DELETE /api/album-order/<path>` clears the places, which is back to name order.
- `PUT /api/item` writes a whole row as given: the import path. When a constraint refuses the row it answers with the constraint's name.

## Why it's this way

**The rules are in the database.** Every rule about a single row, the path grammar, required fields, formats, one type's fields being empty for the other, a crop fitting inside its image, is a named constraint in `schema.ts`, so nothing, a hand-run script included, can write a row that breaks one. What a constraint cannot express, a rule that looks at another row, is checked in `api/src/gallery/`, and so is every rule a user should see explained. So a broken rule the user can fix is a 400 with a message, and a constraint failing is a bug, answered with a 500.

**A path is for now and an id is for later.** A request names what it acts on by path, and the statement resolves the path as it runs, so a path that moved since the page loaded answers 404. But anything the database keeps in order to act on later, an album's thumbnail, the album an upload goes into, the item an upload replaces, references a row's id, with a foreign key that clears it when that row is deleted. So a reference cannot be renamed out from under, and a deleted one leaves a null rather than a dangling path.

**A write's conditions are in its statement.** D1 has no interactive transactions: its one atomic unit is a batch of statements fixed before any runs, so a write cannot read, decide and then write. A rule that depends on another row is a condition of the writing statement instead, an `EXISTS` in its `WHERE` or an `INSERT … SELECT` that selects nothing when the rule fails. There is never a race between a check and the write it guards.
