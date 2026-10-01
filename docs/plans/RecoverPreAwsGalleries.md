# Recovering lost content from pre-AWS galleries

The AWS gallery database and media files have been copied to Cloudflare ([Migrating the AWS gallery data](AwsDataMigration.md)). However, over the decades, there's been other systems and other migrations; see [History of the Tacocat Gallery](../HistoryOfTacocatGallery.md). Some (all?) of those migrations have left photos / videos / albums behind.

Order of work:

- [Zenphoto](#zenphoto)
- [Gallery 2](#gallery-2)
- Lost photos and videos from the [static gallery](#pix) prior to Zenphoto and Gallery 2, which is more labor-intensive because Moses needs to review each video
- [Compare originals in Dropbox with the gallery](#dropbox), which may add more; and last
- Once everything is in, perhaps [pre-generate the derived images](AwsDataMigration.md#pre-generate-derived-images).

Each recovery is [its own script](#how-the-recoveries-are-built).

## Where the originals are

Moses' originals are in two Dropbox folders: `Photos/albums`, the published albums, and `Photos/raw`, the raw originals behind them, TIFFs, camera raws and the like. **Nothing ever writes to either, and nothing reads the rest of the Dropbox.** They are read through a Dropbox app whose only permissions are `files.metadata.read` and `files.content.read`, as the rclone remote `dropbox-ro`, so Dropbox itself refuses a write; a request for an upload link was refused for want of `files.content.write`. The laptop's own Dropbox folder is not read, since many of its files are online-only placeholders that reading would download. The folders are a starting point, not the truth: albums online were renamed, added to, pruned and moved after they were published from them, so a photo is found by its name and date and checked by its shape and caption, as the comparisons do.

`Photos/raw` has folders named `not_for_tacocat`, such as `raw/2020/01-02/not_for_tacocat/`, which hold what was not published to the site. That includes every video before January 2026, since no gallery played video until AWS did then, so a video recovered from the static gallery comes from one ([`pix/`](#pix)). Zenphoto's test album `2022/11-01/not_for_tacocat/` stays behind.

The older systems' files are at DreamHost, read over SSH as `deanmoses@tacocat.com` with the laptop's key: Gallery 2's in `~/g2data/albums/`, 3.8 GB, the static gallery's in `~/tacocat.com/pix/`, 519 MB, and Zenphoto's in `~/tacocat.com/zenphoto/`, 121 GB. The same account serves the `tacocat.com` home page, so it is only read: anything that would write, move or delete there is asked about first.

## Zenphoto

Before AWS the gallery ran at DreamHost, on Gallery 2 from about 2007 to 2014 and on Zenphoto from late 2014 to 2023, and both databases are still there ([Log](#log), 2026-09-30, DreamHost databases). The 2023 move to AWS copied Zenphoto's files into S3 on 2023-12-13 and wrote a DynamoDB row for each published album and photo, and none for an unpublished one. That left 11 albums as files in S3 with no rows, which the [S3 version check](AwsDataMigration.md#s3-version-check) found: `1977/12-31/`, `2007/01-07/`, `2008/01-10/`, `2008/12-07/`, `2009/05-16/`, `2015/03-25/`, `2015/07-12/`, `2016/08-01/`, `2019/09-14/`, `2019/09-21/` and `2023/01-10/`. Each is unpublished in Zenphoto, and their photos add up to exactly the check's 147. They are drafts, then, and some may have been held back on purpose: the caption of `/2008/01-13/` links readers to `/2008/01-10`, "Felix's class bake a king cake", yet that album stayed unpublished, and its captions name about a dozen of Felix's classmates. The move left behind the one unpublished photo in a published album the same way, `2015/01-11/a4-aceeyah-laughing.jpg`.

The comparison of Zenphoto with DynamoDB found nothing else the move lost ([Log](#log), 2026-09-30, Zenphoto comparison). Every published album and photo is on AWS with the same words in its title and caption, or was renamed, moved or replaced there since. Of the 18 other files the S3 check left behind, `a4-aceeyah-laughing.jpg` is the only one Zenphoto ever listed.

**Decided: all 11 albums come back unpublished**, and Moses publishes each by hand once he has looked at it. The AWS copy is done and verified, so the recovery is an addition to it. Each photo goes in through the Worker's own upload, so the pipeline reads its size from the file. The files come from `Photos/albums`, which holds all 147 under their own names in the album folder of the same date and `a4-aceeyah-laughing.jpg` too, but for `2015/03-25/`, whose 11 are only in `Photos/raw`. Each of the 147 is the same size in Dropbox as in S3, so they are the same files and either serves. The titles and captions come from Zenphoto as the 2023 move took them: PHP-serialized values unpacked to their `en_US` text, entities decoded, and `href="#2008/01-10"` links rewritten to `/2008/01-10`. The album summaries come from Zenphoto's `custom_data`, and the names and order come from the copy's rules (`aws-names.ts`). Zenphoto's test albums, `1993/08-15/test1/` and `2022/11-01/not_for_tacocat/` with what they hold, stay behind.

Decided when the recovery runs, by Moses looking at each photo, since a name and a caption cannot settle them:

- **`2015/01-11/a4-aceeyah-laughing.jpg`**, the unpublished photo in a published album. A photo shows whenever its album does and has no published flag of its own, so it would be seen in `/2015/01-11/` as soon as it is imported.
- **12 stale Zenphoto rows with no photo on AWS** ([Log](#log), 2026-09-30, Zenphoto comparison): `ofranda1.jpg`, `ofranda2.jpg`, `zalva2.jpg`, `fancy.jpg` and `bird_watchers9.jpg`, and 7 of `academynext1.jpg` to `academynext9.jpg`, which have only two AcademyNEXT photos on AWS between them. Each is either a draft Moses dropped or a photo the gallery lacks. Dropbox has `academynext1.jpg` in `Photos/albums/2018/06-29/`, and raws named `ofrenda`, not `ofranda`, in `Photos/raw/2018/10-14/` and `10-23/`; it has no `zalva2`, `fancy` or `bird_watchers9`, whose `raw/2022/01-17/` runs to `bird_watchers8`.

## Gallery 2

Gallery 2's database, `pictures`, holds 447 albums and 10,665 photos, the albums created from 2006-12-26 to 2014-12-28. The gallery was copied into Zenphoto in November and December 2014, the dates of Zenphoto's photo files. Comparing Gallery 2 with Zenphoto, and what Zenphoto lacks with the gallery as it is now, found that move lost three albums, a dozen photos and some text, and brought everything else across ([Log](#log), 2026-09-30, Gallery 2 comparison). Gallery 2's 35 sub-albums, such as `2009/05-17/yosemite`, became day albums of their own in Zenphoto, often a day or two off, as `2009/11-01/party` became `2009/10-30/`.

What the gallery lacks:

- **Three albums, all public in Gallery 2**:
    - `2008/02-03/`: Lucie badged at Google. 11 photos, and 11 of its preschool sub-album `pk`.
    - `2008/04-13/`: Felix's class play, _Le Petit Chaperon Rouge_. 22 photos.
    - `2012/06-22/`: "Holy Allowance, Batman!". 7 of its 8 photos; `batman.jpg` is in `2011/02-27/`.
- **Single photos from albums that did come across**:
    - `2008/01-21/tatou/`: `piano.jpg`, `zzzz.jpg`, `croissants.jpg` and `totland6.jpg`.
    - `2007/07-01/kingswim4_001.jpg`, `2008/07-06/motrip/petronas2.jpg` and `2011/01-23/a-comment-system.png`.
    - `2011/05-08/vincennes2.jpg` and `zzzmothersday.jpg`, which were not public in Gallery 2.
    - `2013/07-01/046.JPG` and `056.JPG`, unless they are `paris14.jpg` and `paris16.jpg` in `/2013/07-01/`, which have their captions and size.
- **Two photo captions**: `2009/04-19/jedi05.jpg` ("Come young padawans, experience the POWER of the DARK SIDE.") and `2012/02-26/kauai23.jpg` ("The lava rocks of Secret Beach.").
- **13 album summaries**, still empty on AWS: `2008/07-06` "Dean in Malaysia", `2010/01-17` "Dean becomes French", `2010/01-24` "Milo's half birthday", `2010/03-07` "Little Red Riding Hood", `2010/03-14` and `2010/03-21` "Lucie in Paris", `2010/03-28` "Milo's first soccer game", `2010/05-16` "Dean in Chicago", `2010/05-23` "Milo's end-of-year class show", `2010/06-13` "Felix turns 8 and a half", `2010/07-11` "The Chloe Marie", `2010/08-08` "Health & packing" and `2014/12-10` "The Tree-ening".

The three albums are added unpublished, for Moses to look over and publish, and the single photos are added to their albums, each through the Worker's upload with its title and caption from Gallery 2. The two captions and 13 summaries are written onto the copied rows. Gallery 2 stores its text entity-escaped, sometimes twice, so it is decoded until nothing changes.

Each file comes from Dropbox where it has the original, and otherwise from Gallery 2's own copy in `~/g2data/albums/`, which holds every one of them, mostly 1024 pixels on the long side and about 150 KB. Dropbox has no folder for any of the three albums and none of their photos by name, so for those Gallery 2's copies are the only ones found. Of the single photos, Dropbox has `piano.jpg`, `zzzz.jpg` and `totland6.jpg` in `Photos/albums/2008/01-22/`, and `lincoln2.jpg` to `lincoln4.jpg` from `2012/06-22/` in `Photos/albums/2017/03-04/`; its `2013/07-01/` holds `paris` photos, not `046.JPG` and `056.JPG`, which makes `paris14.jpg` and `paris16.jpg` likelier to be them.

Left behind: the nine TIFFs in `2008/08-21/`, Gallery 2's `2008/08-24/photoshoot/couple01.tif` to `milo01.tif`, which the [S3 version check](AwsDataMigration.md#s3-version-check) also found. The gallery has never served a TIFF, and Moses takes them for raw originals pushed to DreamHost by mistake. The other text that differs reads as Moses' later edits in Zenphoto, "Happy Birthday, America!" becoming "4th of July", or as spacing and punctuation.

The 2013 and 2014 prototypes hold nothing the gallery needs: Gallery 3's `tacocat_gallery3` has 11 photos and Piwigo's `themosii_com` and `themosii_com_1` 89 and 5, all added on the days the systems were tried.

## `pix/`

From 2001 to 2006 the gallery was static HTML served from `~/tacocat.com/pix/` at DreamHost, where it still is: 519 MB, folders for 1968ish, 1969, 1973, 1999 and 2001 to 2006. LView Pro's web gallery generated the albums of 2001 to 2004, each a folder `YYYY/MM/DD/` with an album page, a page per photo in `html/` and the images in `images/`; JAlbum, with a skin of Moses' own, made those of 2005 and 2006, with a page and image per photo in `slides/` ([History of the Tacocat Gallery](../HistoryOfTacocatGallery.md)). Comparing it with the gallery ([Log](#log), 2026-09-30, Static gallery comparison) found its photos almost all came across, and its videos almost none.

**Photos.** Of the 4,710 photos a reader could reach from an album page, directly or through the photos' Next and Previous links, 4,492 are in the gallery. Another 150 have pages nothing links to, left when Moses regenerated an album under new names, as `2005/10/23/`'s old `block_01_street` beside the current `block_01`; they are superseded. About 218 reachable photos are not in the gallery:

- `2002/04/02/`, "Week 16", the whole album: about 20 photos of Felix's baby friends.
- Sub-albums: `2006/06/27/swim/`, 25 photos captioned with the swim class's names; `2006/newschool/`, 16 class portraits; `2003/08/24/uncute/`, 11, "Dean was punk, once."; the house tour of `2004/04/08/`, 10 in `downstairs/`, `outside/` and `upstairs/`; and `2005/08/window/`, four photos of a window's measurements.
- 14 of `2005/12/11/`, and a few others: `2001/12/13/very_first_picture_ever.jpg` and `harriet.jpg`, Ezekiel's birthday in `2002/11/17/`, the Soublins in `2002/12/29/`, the ultrasound of `2003/12/ultrasound_bastille/`, two of `2004/11/28/`, and holiday GIFs.
- 84 scans in `1968ish/` and `1969/05/`, `07/`, `09/` and `12/`, mostly uncaptioned, which may be the scans Moses' rescans replaced.
- 40 photos of 1999, from before the albums, when `pix/` was the web server's bare listings of folders such as `pix/1999-06/` and `pix/1999-10/halloween/`, now `pix/1999/06/` and `pix/1999/10/`: 25 of `1999/06/home/`, such as `angelfish.jpg` and `cat-stairs.jpg`, 3 of `1999/06/spiral/`, 4 of `1999/10/deanparty/`, 6 of `1999/10/house/`, `1999/07/bday-tarzan-lucie.jpg` and `1999/11/imber.jpg`. The rest of those folders, 54 photos, are in the gallery's 1999 albums.

The albums of December 2001 to 2003 were first published under folders named for their weeks, such as `pix/2001.12.17-23/` and `pix/2002.4.2-4.15/`, and moved to `pix/YYYY/MM/DD/` on 2007-01-09. The Internet Archive's index of `tacocat.com/pix/` names 1,418 photos in 99 of those first folders, about half of them, and every one is in the moved copy but `2001.12.24-31/pumping.jpg`, which the gallery lacks too.

They are added unpublished, for Moses to look over and publish, each through the Worker's upload with its caption from its static page, from Dropbox where it has the original and from `pix/` where it does not. The captions that differ read as later edits.

**Videos.** The static gallery had 42, and no later gallery took them: before AWS no gallery played video, so Moses hand-cut a small copy of each, uploaded it beside the album and linked it from the album's text rather than its Next and Previous links. Only `2002/05-20/monster.avi` and `2002/05-27/peekaboo.avi` are in the gallery now. Each of the other 40 becomes a gallery item in its album, which its own album page names for all but two: 33 album pages link their `video/` folder and 7 the file by name, and only `2002/04/29/sasha/MVI_0818.AVI` and `2005/01/02/video/milo_crawling.MPG` have no link.

The copy that goes in is the best one. 15 have a larger original in Dropbox, mostly an AVI beside the small MPEG in a `Photos/raw/…/not_for_tacocat/video/` folder, such as `first_ever_stand_unassisted.avi` at 7.2 MB against the static gallery's 0.2 MB; `hello_goodbye.avi` is in `Photos/albums/2002/05-13/`. 17 are in Dropbox only at the static gallery's size, and 8 only in `pix/`: `bouncing.avi`, `sasha/MVI_0818.AVI`, `fall_small.MPG`, `crib_play.mpg`, `reading-short.MPG`, `milo_crawling.MPG`, `milo_flip.mov` and `tickle-monster.wmv`. The small copies were cut down to snippets of the originals, so **Moses watches each original before it goes on the site**, and chooses between it and the snippet. Each goes in through the Worker's upload, which transcodes it.

Two folders beside `pix/` on the site were never part of the gallery and add nothing to it: `felix/`, a page of Felix's books in 2002, his first birthday's invitation and his school and coding projects of 2012 to 2015; and `giraffe/`, two recordings of August 2011, `Chapter 1.mov` and `Chapter 2.mov`, which are sound alone, 3 and 37 minutes.

## Dropbox

We should compare the originals in Dropbox with the gallery. Every comparison so far started from what was published; this one starts from what went into publishing, so it finds an album or photo that only Dropbox holds, and it has 25 years of renames, culls, re-edits and moved albums to see past. So it is narrowed before it compares anything:

1. **Only `Photos/albums`**, the published albums. `Photos/raw` is only where a better original is looked for, once something is known to be missing. Sidecars, `.BridgeSort`, `.picasa.ini`, `Thumbs.db` and zero-byte files are dropped.
2. **Exact bytes first.** The gallery's originals were uploaded from these files, so a Dropbox file of the same size as an original in S3, any version, with a like name or date, is that original, however it was renamed or moved since; `pix/` and `~/g2data/albums/` count the same way. This should settle most files without downloading any.
3. **Albums, not photos.** What is left is reported by album: a Dropbox album folder with no gallery album within a few days, or none of whose files matched, is a likely lost album; one holding many more photos than its gallery album is worth a look; one or two stragglers in a matched album are almost always culls, and are only counted.
4. **One year first.** It runs on 2024, which Moses remembers, and he says which of its flags are noise before it runs on all 25 years.
5. **A close look only for the short list.** Photos re-saved or cropped since are compared by what they show, from their Dropbox files and the gallery's thumbnails, for a few dozen at most.

## How the recoveries are built

Each recovery will be its own script in `api/scripts/`. What they share is writing to the gallery: making an album unpublished, uploading a file through the Worker's presigned PUT as a browser does, so the pipeline sizes it, transcodes a video and makes its derived images, waiting for the pipeline, and writing a title, caption or summary. `import-album.ts` already does all of that for an album read from the AWS API, so consider pulling it out into a module the recovery scripts share, and `import-album.ts` keeps working on top of it. Each script should have the copy's guardrails (`migration-run.ts`): `--only` or `--all`, `--to`, nothing written without `--go`; and each should run on staging before production.

The Gallery 2 script also writes onto rows the copy made, the two captions and 13 summaries, and adds single photos to published albums. The static gallery's script runs once Moses has watched the videos.

## Log

### 2026-09-30

#### Static gallery comparison

`pix/` was copied to `~/dev/tacocat-migration/dreamhost-files/pix/` with rsync, 517 MB in 15 seconds. `~/dev/tacocat-migration/pix/inventory.mjs` rebuilt it from its pages into `items.jsonl`: 307 album pages, 4,924 photos with their captions and sizes, read from each image's header, 42 videos, and 248 images no page shows. A photo page counts as reachable when a crawl from its album page, through the links inside the album, finds it. `compare.mjs` then matched each photo to the gallery by name in a gallery album within a week of its own, by name in the same year at the same shape, or by caption, and wrote `diffs.jsonl`.

- 4,492 reachable photos matched, 16 of them by a name more than a week away, of which a few are wrong: `2004/11/28/milo2.jpg` matched `2004/11-14/milo2.jpg`, another photo. 218 reachable photos and 150 unreachable ones did not.
- The 16 captions missing from the gallery are the generator's boilerplate, `$comment` and "section of an HTML document", not text; the 92 that differ read as later edits, "jazzatronic brunch", "Jeannette".
- Each video was looked up in the Dropbox listings by its name, with `_small` taken off, in its own year.

#### DreamHost file listings

`find` listed each file's size, date and path in Zenphoto's `albums/` and Gallery 2's `albums/` into `~/dev/tacocat-migration/dreamhost-files/`, to find a file a move never copied, which the comparisons of the databases cannot see. None turned up.

- **Zenphoto against S3's current keys.** Of its 31,976 files, 31,850 are in S3 at the same path and size. 84 of the 85 S3 lacks are the photos renamed or moved on AWS, since a rename there deletes the old key, the two `lucie_preggie.JPG` renamed by the move, and the test albums' files; the 85th is Zenphoto's own `.gitignore`. The 41 at another size differ by a few KB, and S3 wrote each of their current versions after the move, on 2023-12-21, 2023-12-28 or in August 2025: photos re-saved on AWS.
- **Gallery 2 against its database.** Its 10,665 files pair with the database's 10,665 photos, but for `2011/09-05/scot00.jpg` on disk where the database names `scot12.jpg`. 20 are larger than the database recorded, such as `2012/10-29/matrix2.jpg`, replaced on disk after their upload; none is a photo to recover.

#### Dropbox listing

`rclone lsjson -R --files-only --hash` of `dropbox-ro:Photos/albums` and `Photos/raw` wrote each file's path, size, date and Dropbox content hash to `~/dev/tacocat-migration/dropbox/`: 36,597 files and 132 GB in `albums`, 21,395 files in `raw`. Nothing was downloaded. Each lost photo was looked up by its name, preferring the folder of its date: the 147 Zenphoto drafts and `a4-aceeyah-laughing.jpg` were all found, none a placeholder; of Gallery 2's losses, only the single photos in [Gallery 2](#gallery-2), and no Dropbox folder of any of its three albums' dates.

#### DreamHost files

The account's files, read over SSH as `deanmoses`, are `~/g2data/`, 4.2 GB, of which `albums/` is 3.8 GB, and under `~/tacocat.com/` the site's home page, `pix/` at 519 MB and `zenphoto/` at 121 GB. `~/g2data/albums/` holds every photo Gallery 2's move lost, under its Gallery 2 path. `pix/` holds 42 videos, listed with `find`.

#### Gallery 2 comparison

A second one-off script, `~/dev/tacocat-migration/gallery2/compare.mjs`, compared Gallery 2's photos, exported from `pictures` to `gallery2/items.jsonl` with each one's path, text, size and whether the Everybody group could view it, with Zenphoto's, writing each difference to `diffs.jsonl` beside it. Each photo was matched by its path; then by its name in its day album, since a sub-album could only have become one; then anywhere by a typed title and caption or by its name, at the same shape. Shape, not size: Gallery 2 holds most photos as 1024- or 640-pixel copies where Zenphoto has the originals, and records some rotated photos with width and height swapped.

- **Photos.** 9,283 at the same path, 12 moved into their day album, and 1,284 renamed or moved, mostly the sub-albums' photos into day albums of their own. 899 of the sub-albums' photos have Zenphoto file dates in November and December 2014, so they came with the move rather than later. 75 others were added to Zenphoto on 2018-04-14, in `2012/04-22/`, `2013/07-01/`, `2013/07-08/` and `2014/04-04/`. 6 are on AWS but not in Zenphoto, and 9 were copies Gallery 2 held twice, such as `2009/12-20/K3/caroline.jpg` beside `2009/09-13/k3/k27.jpg`. That leaves the 3 albums and the photos in [Gallery 2](#gallery-2), and the 9 TIFFs.
- **Text.** 2 photo captions and 13 album summaries are in Gallery 2 and nowhere since. Of the rest, 154 titles, 101 captions, 79 summaries and 39 album descriptions differ, by later edits and by spacing and punctuation.
- **Visibility.** `2007/01-07/` and `2008/12-07/`, two of the Zenphoto drafts, were public in Gallery 2. Its one album the public could not see, `2010/04-04/`, came across.

#### Zenphoto comparison

A one-off script outside the repo, `~/dev/tacocat-migration/zenphoto/compare.mjs`, compared the Zenphoto export with the DynamoDB scan, writing each difference to `diffs.jsonl` beside it. Zenphoto's text was normalized as the 2023 move had done it: PHP-serialized values unpacked, entities decoded, `#` links rewritten. Rows updated on AWS after 2023-12-13 were counted apart, since an edit there accounts for a difference.

- **Text.** No published album or photo lost a word of its title, caption or summary. The 3,730 photo captions and 217 album descriptions that differ do so only in whitespace and markup: a trailing space inside a `<p>`, a dropped `<br>`, `&nbsp;`.
- **75 published photos absent from AWS**, all accounted for. 52 were renamed on AWS on 2023-12-28, such as `2016/04-10/philly1.JPG` to `philadelphia1.jpg` and `2014/10-16/IMG_2523.JPG` to `dreamforce1.jpg`, some recaptioned on the way; each matched by album, size, and title, caption or name. 14 were renamed by the move itself, such as `2001/09-21/lucie_preggie.JPG` to `.jpg`. `1969/07-20/marriage01.jpg` to `marriage04.jpg` are 400×400 scans the album's 2024-09-08 rescans replaced. The two OK Corral photos and Majorca moved from `1982/12-01/` to `1982/07-15/` and `1982/08-01/`, and `2001/09-05/z_ocean_beach.jpg` became `2001/08-20/ocean_beach2.jpg`, all in 2025, at the same sizes. A rename on AWS leaves nothing of the old key in S3's history, which is why these were matched by their content rather than looked up there.
- **122 Zenphoto rows whose album no longer exists**, left when albums were renamed or deleted in Zenphoto. 106 are on AWS under the same name in another album, and `monster_tucks2.jpg`, `monster_tucks3.jpg` and `tennis7.jpg` match a photo there by title and size. The nine `academynext` photos of July 2018 have two counterparts between them, the AcademyNEXT photos `2018/07-05/camp05.jpg` and `2018/06-26/stanford1.jpg`, so seven have none of their own; they may be among `2018/07-05/`'s photos under other names and titles. 5 match nothing on AWS or in S3: `ofranda1.jpg` and `ofranda2.jpg` from November 2018, `zalva2.jpg` from May 2020, and `fancy.jpg` and `bird_watchers9.jpg` from January 2022. Those 12 are decided when the recovery runs ([Zenphoto](#zenphoto)).
- **Unpublished**: the 11 albums and `2015/01-11/a4-aceeyah-laughing.jpg` ([Zenphoto](#zenphoto)). Of the 18 other files the S3 check left behind, the rest were never in Zenphoto: the TIFFs, the raw files and the `.heic` were uploaded beside photos Zenphoto listed, and the PNGs of `2025/04-27/` came after it.
- **Fields AWS never had**: two locations, `2015/04-13/` "Utah" and `2021/07-23/richuisa2.jpeg` "Corse", and six album titles other than the folder's name, such as "November 23" on `2014/11-23/`. Left behind.

#### DreamHost databases

Moses made a MySQL user at DreamHost, `cf_migration`, with SELECT on the five gallery databases alone and the laptop's address among its allowed hosts. Its credentials are in `~/dev/tacocat-migration/dreamhost-mysql.cnf`, mounted read-only into a `mysql:8.4` container, so the password is in no command or log. `gallery3.tacocat.com` is the server's hostname. `mysqldump` with `--single-transaction --skip-lock-tables --no-tablespaces` wrote each database to `~/dev/tacocat-migration/dreamhost/`, outside the repo since they hold the drafts, and Zenphoto's albums and photos with their tags went to `~/dev/tacocat-migration/zenphoto/` as JSON lines.

| Database           | What it is | Holds                                   | Dates                                                                      |
| ------------------ | ---------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `pictures`         | Gallery 2  | 447 albums, 10,665 photos               | created 2006-12-26 to 2014-12-28; taken from 1999                          |
| `tacocatzenphoto`  | Zenphoto   | 1,549 albums, 31,890 photos, 1,924 tags | photo files 2014-11-23 to 2023-12-12; album dates from 1943, as scans' are |
| `tacocat_gallery3` | Gallery 3  | 4 albums, 11 photos                     | all 2013-09-11                                                             |
| `themosii_com`     | Piwigo     | 24 albums, 89 photos                    | 2013-09-11 and 12                                                          |
| `themosii_com_1`   | Piwigo     | 3 albums, 5 photos                      | 2014-11-23                                                                 |

So the gallery was Gallery 2 until late 2014 and Zenphoto only from then, and Gallery 3 and Piwigo were tried and dropped. Zenphoto stores some titles and captions as PHP-serialized arrays keyed by locale, `a:1:{s:5:"en_US";s:5:"07-04";}`, and others as plain text, and an album's summary in `custom_data`.
