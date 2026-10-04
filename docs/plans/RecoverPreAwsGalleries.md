# Recovering lost content from pre-AWS galleries

The AWS gallery database and media files have been copied to Cloudflare ([Migrating the AWS gallery data](migration_from_aws/AwsDataMigration.md)). However, over the decades, there's been other systems and other migrations; see [History of the Tacocat Gallery](../HistoryOfTacocatGallery.md). Some (all?) of those migrations have left photos / videos / albums behind.

Order of work:

- ✅ [Zenphoto](#zenphoto): done, 11 albums and one photo recovered
- ✅ [Gallery 2](#gallery-2): done, four albums published, one photo and the lost words recovered
- ✅ [Gallery 2's hand orders](#gallery-2s-hand-orders): done, 50 albums back in the order they were given by hand
- ✅ [Gallery 2's thumbnails](#gallery-2s-thumbnails): done, 241 hand-cut thumbnail crops and 10 albums' thumbnails back on staging and production
- Lost photos and videos from the [static gallery](#pix) prior to Zenphoto and Gallery 2, which is more labor-intensive because Moses needs to review each video
- [Compare originals in Dropbox with the gallery](#dropbox), which may add more; and last
- Once everything is in, perhaps [pre-generate the derived images](migration_from_aws/AwsDataMigration.md#pre-generate-derived-images).

Each recovery is [its own script](#how-the-recoveries-are-built).

## Where the originals are

Moses' originals are in two Dropbox folders: `Photos/albums`, the published albums, and `Photos/raw`, the raw originals behind them, TIFFs, camera raws and the like. **Nothing ever writes to either, and nothing reads the rest of the Dropbox.** They are read through a Dropbox app whose only permissions are `files.metadata.read` and `files.content.read`, as the rclone remote `dropbox-ro`, so Dropbox itself refuses a write; a request for an upload link was refused for want of `files.content.write`. The laptop's own Dropbox folder is not read, since many of its files are online-only placeholders that reading would download. The folders are a starting point, not the truth: albums online were renamed, added to, pruned and moved after they were published from them, so a photo is found by its name and date and checked by its shape and caption, as the comparisons do.

`Photos/raw` has folders named `not_for_tacocat`, such as `raw/2020/01-02/not_for_tacocat/`, which hold what was not published to the site. That includes every video before January 2026, since no gallery played video until AWS did then, so a video recovered from the static gallery comes from one ([`pix/`](#pix)). Zenphoto's test album `2022/11-01/not_for_tacocat/` stays behind.

The older systems' files are at DreamHost, read over SSH as `deanmoses@tacocat.com` with the laptop's key: Gallery 2's in `~/g2data/albums/`, 3.8 GB, the static gallery's in `~/tacocat.com/pix/`, 519 MB, and Zenphoto's in `~/tacocat.com/zenphoto/`, 121 GB. The same account serves the `tacocat.com` home page, so it is only read: anything that would write, move or delete there is asked about first. Since 2026-10-02 Apache no longer serves the galleries, Zenphoto's `/zenphoto/` and `/p_json/` and the static `/pix/` among them, and DreamHost no longer hosts `prod-pix.tacocat.com` or `dev-pix.tacocat.com` (deanmoses/tacocat#2); the files and databases are untouched and SSH reads them as before.

## Zenphoto

✅ This is DONE: the 11 unpublished albums and the one hidden photo are on staging and production, the 12 stale rows turned out to be photos the gallery has, and Zenphoto held no sub-albums. Moses publishes the albums himself.

Before AWS the gallery ran at DreamHost, on Gallery 2 from about 2007 to 2014 and on Zenphoto from late 2014 to 2023, and both databases are still there ([Log](#log), 2026-09-30, DreamHost databases). The 2023 move to AWS copied Zenphoto's files into S3 on 2023-12-13 and wrote a DynamoDB row for each published album and photo, and none for an unpublished one. That left 11 albums as files in S3 with no rows, which the [S3 version check](migration_from_aws/AwsDataMigration.md#s3-version-check) found: `1977/12-31/`, `2007/01-07/`, `2008/01-10/`, `2008/12-07/`, `2009/05-16/`, `2015/03-25/`, `2015/07-12/`, `2016/08-01/`, `2019/09-14/`, `2019/09-21/` and `2023/01-10/`. Each is unpublished in Zenphoto, and their photos add up to exactly the check's 147. They are drafts, then, and some may have been held back on purpose: the caption of `/2008/01-13/` links readers to `/2008/01-10`, "Felix's class bake a king cake", yet that album stayed unpublished, and its captions name about a dozen of Felix's classmates. The move left behind the one unpublished photo in a published album the same way, `2015/01-11/a4-aceeyah-laughing.jpg`.

The comparison of Zenphoto with DynamoDB found nothing else the move lost ([Log](#log), 2026-09-30, Zenphoto comparison). Every published album and photo is on AWS with the same words in its title and caption, or was renamed, moved or replaced there since. Of the 18 other files the S3 check left behind, `a4-aceeyah-laughing.jpg` is the only one Zenphoto ever listed.

**Decided: all 11 albums come back unpublished**, and Moses publishes each by hand once he has looked at it. The AWS copy is done and verified, so the recovery is an addition to it. Each photo goes in through the Worker's own upload, so the pipeline reads its size from the file. The files come from `Photos/albums`, which holds all 147 under their own names in the album folder of the same date and `a4-aceeyah-laughing.jpg` too, but for `2015/03-25/`, whose 11 are only in `Photos/raw`. Each of the 147 is the same size in Dropbox as in S3, so they are the same files and either serves. The titles and captions come from Zenphoto as the 2023 move took them: PHP-serialized values unpacked to their `en_US` text, entities decoded, and `href="#2008/01-10"` links rewritten to `/2008/01-10`. The album summaries come from Zenphoto's `custom_data`, and the names and order come from the copy's rules (`aws-names.ts`). Zenphoto's test albums, `1993/08-15/test1/` and `2022/11-01/not_for_tacocat/` with what they hold, stay behind.

**The 11 albums are on staging and production**, unpublished, put there by `api/scripts/recovery/recover-zenphoto.ts` ([Log](#log), 2026-10-01). Moses looked them over on staging and publishes them himself.

What a name and a caption could not settle, settled on 2026-10-01:

- ✅ **`2015/01-11/a4-aceeyah-laughing.jpg`**, the unpublished photo in a published album. A photo shows whenever its album does and has no published flag of its own, so the script leaves such a photo out of `--all` and adds it only when told `--only /2015/01-11/`. Moses said to add it, and it is on staging and production as `/2015/01-11/a4_aceeyah_laughing`; he looked at it and keeps it.
- ✅ **12 stale Zenphoto rows with no photo on AWS**: none is a lost photo ([Log](#log), 2026-10-01, The 12 stale Zenphoto rows). Each was renamed or re-saved in Zenphoto before the 2023 move, and the gallery has it under its later name. Moses called them closed.
- ✅ **Sub-albums**: Zenphoto could nest an album inside a day album, and held none but its two test trees, in its database or on its disk ([Log](#log), 2026-10-01, Zenphoto has no sub-albums).

## Gallery 2

Gallery 2's database, `pictures`, holds 447 albums and 10,665 photos, the albums created from 2006-12-26 to 2014-12-28. The gallery was copied into Zenphoto in November and December 2014, the dates of Zenphoto's photo files. Comparing Gallery 2 with Zenphoto, and what Zenphoto lacks with the gallery as it is now, found that move lost three albums, a dozen photos and some text, and brought everything else across ([Log](#log), 2026-09-30, Gallery 2 comparison). Gallery 2's 35 sub-albums, such as `2009/05-17/yosemite`, became day albums of their own in Zenphoto, often a day or two off, as `2009/11-01/party` became `2009/10-30/`.

**That comparison missed a fourth album**, the sub-album `2008/01-21/tatou`, which is recovered ([Log](#log), 2026-10-01, Tatou's Weekend with Felix). It had matched nine of the album's 13 photos by name alone to unrelated photos, as `tatou/totland1.jpg` to `2002/11-17/totland1.jpg`, whose captions differ. **A second pass checked every match against its words, place and time** ([Log](#log), 2026-10-03, Gallery 2 matches rechecked): it found no other lost album, but more lost photos in the three albums, fewer lost single photos, and two of the doc's Dropbox and gallery counterparts wrong. The list below is that pass's.

What the gallery lacks:

- ✅ **Three albums, all public in Gallery 2**, on staging and production, and published on production by Moses on 2026-10-04 with `pk`'s:
    - `2008/02-03/`: Lucie badged at Google. 11 photos, and 20 of its preschool sub-album `pk`, which is `/2008/02-02/`, the day before the album that held it.
    - `2008/04-13/`: Felix's class play, _Le Petit Chaperon Rouge_. 24 photos.
    - `2012/06-22/`: "Holy Allowance, Batman!". All 8 photos; its `batman.jpg`, "It took 2 months of allowance…", is not `2011/02-27/batman.jpg`, "Batboat".
- **Single photos from albums that did come across**:
    - ✅ `2008/01-21/tatou/`: listed here as four photos, `piano.jpg`, `zzzz.jpg`, `croissants.jpg` and `totland6.jpg`, and in fact the whole sub-album, 13 photos, now `/2008/01-22/` on staging and production, unpublished.
    - ✅ `2011/05-08/zzzmothersday.jpg`, which was not public in Gallery 2, on staging and production. Moses kept it after looking at it on staging.
    - Left behind after Moses looked at them on staging: `2007/07-01/kingswim4_001.jpg`, a duplicate of `kingswim4`, though its caption, "Decca flies the friendly skies.", Moses put onto the gallery's `kingswim4` by hand; `2011/01-23/a-comment-system.png`; and `2011/05-08/vincennes2.jpg`.
- ✅ **Two photo titles and captions**, on staging and production: `2009/04-19/jedi05.jpg`, "Jedi 5", "Come young padawans, experience the POWER of the DARK SIDE.", and `2012/02-26/kauai23.jpg`, "Secret Beach", "The lava rocks of Secret Beach.". The titles turned up when the captions were written: they are the only two of the 154 titles that differ that Zenphoto has none of.
- ✅ **11 album summaries**, on staging and production: `2010/01-17` "Dean becomes French", `2010/01-24` "Milo's half birthday", `2010/03-07` "Little Red Riding Hood", `2010/03-14` and `2010/03-21` "Lucie in Paris", `2010/03-28` "Milo's first soccer game", `2010/05-23` "Milo's end-of-year class show", `2010/06-13` "Felix turns 8 and a half", `2010/07-11` "The Chloe Marie", `2010/08-08` "Health & packing" and `2014/12-10` "The Tree-ening". Two more the comparison found were not lost: `2008/07-06`'s "Dean in Malaysia" and `2010/05-16`'s "Dean in Chicago" named the day album's sub-album, `motrip` and `chicago`, which the move made `/2008/07-04/` and `/2010/05-17/`, and those have the summary. The other 11 albums held no sub-album.

The three albums are added unpublished, for Moses to look over and publish, as he did, and the single photos are added to their albums, each through the Worker's upload with its title and caption from Gallery 2. The two titles and captions and 11 summaries are written onto the copied rows, where the field is still empty. Gallery 2 stores its text entity-escaped, sometimes twice, so it is decoded until nothing changes.

Each file comes from Dropbox where it has the original, and otherwise from Gallery 2's own copy in `~/g2data/albums/`, which holds every one of them; Moses accepted the copies, which for `2008/04-13/` are 1024 pixels on the long side and about 150 KB, and for the others mostly the camera's size. Dropbox has no folder for any of the three albums and none of their photos by name, nor any of the four single photos, so all 67 are Gallery 2's copies; its `2017/03-04/lincoln1.jpg` to `lincoln4.jpg` are the 2017 trip to Washington, not `2012/06-22/`'s.

Left behind: the nine TIFFs in `2008/08-21/`, Gallery 2's `2008/08-24/photoshoot/couple01.tif` to `milo01.tif`, which the [S3 version check](migration_from_aws/AwsDataMigration.md#s3-version-check) also found. The gallery has never served a TIFF, and Moses takes them for raw originals pushed to DreamHost by mistake. The other text that differs reads as Moses' later edits in Zenphoto, "Happy Birthday, America!" becoming "4th of July", or as spacing and punctuation.

The 2013 and 2014 prototypes hold nothing the gallery needs: Gallery 3's `tacocat_gallery3` has 11 photos and Piwigo's `themosii_com` and `themosii_com_1` 89 and 5, all added on the days the systems were tried.

## Gallery 2's hand orders

Gallery 2 showed an album in name order unless an admin dragged its photos into an order of their own, and 59 of its 447 albums were, between 2007 and 2014. Zenphoto had the same feature and it was used twice, on `/2010/01-24/`, which Gallery 2 had ordered too, and `/2015/08-16/`. The 2014 move to Zenphoto carried names and not orders, and Zenphoto sorted by name, so an order survived it only where the move renamed the files to match, as `2013/07-01/`'s `002.JPG` to `088.JPG` became `paris01.jpg` to `paris28.jpg`. The 2023 move to AWS did the same for Zenphoto's two, renaming `epiphanieg8-1.jpg` to `epiphanieng8_1.jpg` and `samance21.jpg` to `samance24.jpg`, and AWS and this gallery sorted by name after it. So 50 albums show their photos in name order where Moses had arranged them, 233 of their 1,442 photos somewhere other than where he put them ([Log](#log), 2026-10-04, Gallery 2's hand orders traced). Most are a series swapped with another or one photo moved to the front; `/2013/06-24/`, the Lost Coast trip, has 36 of 54 out of place, `/2012/09-28/` 18 of 37 and `/2010/04-18/` 12 of 22. `/2010/10-10/`'s order, which the copy from AWS kept for the story its captions tell, is itself name order: Gallery 2 had `eiffel` second, not tenth.

Every photo traces by name from Gallery 2 through the Zenphoto photo the comparison matched it to, and the AWS copy's renaming, to a row on production, so `reorder-gallery2.ts` writes each album's order through the Worker's own order write and uploads nothing. `/2010/01-24/` keeps Zenphoto's order, the later decision. A photo culled since is left out, as `2007/07-01/kingswim4_001.jpg` was; one added since follows in name order, as the gallery shows an ordered album's additions. The six albums the copy gave AWS's order, to keep it through sanitizing, get Gallery 2's instead, which is what their order was before the 2014 move lost it, each named with `--only`: under `--all` the script leaves an album shown in an order of its own alone, since nothing tells the copy's order from one an admin set here since. A photo an album seems to hold under `_n`, the name the copy gave a collision, stops that album's write; none does.

✅ This is DONE: **all 50 are on staging and production** in Gallery 2's order ([Log](#log), 2026-10-04, Gallery 2's orders on staging and production).

## Gallery 2's thumbnails

Gallery 2 let an admin cut a photo's thumbnail from a square of it, and pick the photo an album is shown by, and the 2014 move to Zenphoto carried neither ([Log](#log), 2026-10-04, Gallery 2's thumbnails traced). Zenphoto's own crops all came across: of its 421, 419 are on AWS to the pixel, `2007/01-07/thejoyces` came back with the [Zenphoto](#zenphoto) recovery, and `2015/08-16/samance21` is `samance24`, renamed by the 2023 move.

- **Crops.** Moses cut 269 thumbnails in Gallery 2, all squares, between 2007 and 2014. He cut 26 of them again in Zenphoto, each close to where he had cut it in Gallery 2, which says the cuts were meant; those stand. The other 243 photos have had a thumbnail from the middle of the photo since 2014, in 135 albums, such as `/2007/01-28/skateboard1`, whose crop is a small part of the frame. 241 come back. `/2012/12-25/carols4` stays as it is: its file is 4:3 where Gallery 2's was 3:2, a different crop of the photo, so Gallery 2's cut would not land where it did. So does `/2008/01-21/indianrock04`, cut by hand on production on 2026-10-04 while this was under way.
- **Album thumbnails.** Of the 397 day albums whose Gallery 2 thumbnail can be followed to the gallery, 264 show it, and 121 show one Moses picked again since, all but one in Zenphoto, which stands. 12 show neither, and nor does the day album the move made of Gallery 2's sub-album `shakescene`: Zenphoto was told no thumbnail for them, so the 2023 move took the photo Zenphoto showed, mostly the album's last by name, such as `zfire` and `xmas`. These are left for a pass of their own: the move's fallback is sometimes the better photo, so each album's two candidates are to be looked at side by side and Moses picks. Gallery 2's for each: `/2008/03-16/` apats, `/2008/11-23/` clay2, `/2008/11-29/` geocaching01b, `/2010/01-17/` eiffel_moses, `/2010/01-31/` karate, `/2010/03-07/` chaperon1, `/2010/03-21/` france18, `/2010/03-28/` soccer1, `/2010/04-04/` wimpy_kid2, `/2012/12-25/` carols4, `/2013/07-08/` aix09 and `/2014/05-26/` arcata_shark3. `/2012/06-04/`, which was Gallery 2's sub-album `2012/06-03/shakescene`, is settled: it keeps `shakescene90`, which Moses compared on staging with Gallery 2's `shakescene13` and judged the better.

Gallery 2 kept each crop in percent of the image, which is what the Worker's thumbnail route takes, so a crop goes on as Gallery 2 wrote it whatever size the gallery's file is. Gallery 2 rotated a photo by making a turned version and leaving the file alone, and cut such a photo's thumbnail from the turned version; the gallery has all 118 of those upright, so those 6 crops are in the gallery's frame too, which a look at the 6 on production confirmed. Each photo traces through `matches.jsonl` as the orders did, and `rethumb-gallery2.ts` writes the crops through the Worker's own thumbnail route and uploads nothing. A crop goes only onto a photo with none and of Gallery 2's shape, within the 1% that Gallery 2's scaled copies round by. Writing a crop makes no image until someone views the album, about three Images transformations a photo, so about 750 in all, inside the month's free 5,000.

Dry runs against staging and production on 2026-10-04 each found the 242 crops and 13 thumbnails to write, and left the 26 crops cut since and `carols4` alone. Four albums then went onto staging, and the album thumbnails came out of the script ([Log](#log), 2026-10-04, Gallery 2's thumbnails on staging).

✅ The crops are DONE: **all 241 are on staging and production** ([Log](#log), 2026-10-04, Gallery 2's crops on staging and production). ✅ The album thumbnails are DONE too: Moses compared each album's two candidates side by side and picked Gallery 2's for 10, which are on staging and production, and kept today's for `/2013/07-08/` (aix36) and `/2014/05-26/` (zee_sequioas2b) ([Log](#log), 2026-10-04, Gallery 2's album thumbnails picked).

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

Each recovery is its own script in `api/scripts/recovery/`. What they share is writing to the gallery, in `gallery-upload.ts`: making an album unpublished, uploading a file through the Worker's presigned PUT as a browser does, so the pipeline sizes it, reads its tags, transcodes a video and makes its derived images, waiting for the pipeline, and writing a title, caption or summary. Each script has the guardrails of `write-guard.ts`: `--only` or `--all`, `--to`, nothing written without `--go`; and each runs on staging before production.

`recover-gallery2.ts` brings back what `gallery2.ts` names: the lost albums, each as the day album it is told, with the link its parent's description held pointed there; the single photos, into their published albums; and the summaries, titles and captions, onto the rows where the field is still empty. `recovery.ts` holds what the scripts share, and reads a file Dropbox lacks from the old gallery's copies under `files/` in the run's directory, which for Gallery 2 are its `~/g2data/albums/` files copied there by their Gallery 2 paths with `rsync --files-from`. A sub-album's photos from Dropbox are checked after the upload by their shape against Gallery 2's copies, since a file in Dropbox may carry another name. The scripts wait 15 minutes for an album's uploads, past the Workflow's 10-minute step timeout and its retry. `reorder-gallery2.ts` reads only the gallery and Gallery 2's `items.jsonl` and `matches.jsonl`, and writes only orders, which `gallery2-order.ts` decides and tests hold. `rethumb-gallery2.ts` reads those and `derivatives.jsonl`, Gallery 2's `g2_Derivative` rows with each one's owner from `g2_ChildEntity`, and writes only crops, which `gallery2-thumbnails.ts` decides and tests hold.

`recover-zenphoto.ts` was the first. What it writes is decided by `zenphoto.ts`, which reads Zenphoto's exported rows and touches no network, so tests hold it. A rerun is a resume: it uploads only the photos an album lacks, leaves the words of an album that is already there as they are, and writes each photo's title and caption again until the album is published, and after that only those of the photos it uploads. It writes an album's thumbnail and order until the album is published.

The static gallery's script runs once Moses has watched the videos.

## Log

### 2026-10-04

#### Gallery 2's album thumbnails picked

A contact sheet put each of the 12 albums' two candidates side by side, as the gallery draws an album's thumbnail, 200×200 with the photo's crop: Gallery 2's pick and production's. Moses picked Gallery 2's for `/2008/03-16/` apats, `/2008/11-23/` clay2, `/2008/11-29/` geocaching01b, `/2010/01-17/` eiffel_moses, `/2010/01-31/` karate, `/2010/03-07/` chaperon1, `/2010/03-21/` france18, `/2010/03-28/` soccer1, `/2010/04-04/` wimpy_kid2 and `/2012/12-25/` carols4, and kept production's for `/2013/07-08/` and `/2014/05-26/`. A one-off run of the album thumbnail route wrote the 10 to staging and then production, each only while the album still showed the photo the move fell back to, logged in `rethumb-staging.jsonl` and `rethumb-production.jsonl`; a guest's read of production shows them. The contact sheet made about 16 new thumbnails on production.

#### Gallery 2's crops on staging and production

`rethumb-gallery2.ts --to staging --all --go` wrote the other 213 crops, 242 on staging with the 29 before, `indianrock04` among them since nobody had cut it there. Moses then ran `--to production --all --go`: 241 crops, logged in `rethumb-production.jsonl`. A rerun against production finds nothing to write: 241 already Gallery 2's, 27 cut since and `carols4` left alone. Each write set a row's crop alone; the thumbnails are made as the albums are viewed, up to about 720 Images transformations on production and 640 on staging.

#### Gallery 2's thumbnails on staging

`rethumb-gallery2.ts --to staging --go` ran for four albums: `/2007/03-11/`, 7 crops, `/2010/11-20/`, the 20 trading cards, `/2008/11-23/`, `clay2`'s crop, cut from the version Gallery 2 had turned, and its thumbnail, and `/2012/06-04/`, `shakescene20`'s crop and the thumbnail `shakescene13`. 29 crops and 2 thumbnails, logged in `rethumb-staging.jsonl`, and a rerun found all 31 already Gallery 2's. Moses compared the albums with production and preferred production's `shakescene90` for `/2012/06-04/`, so staging's thumbnail was put back to it. The other 11 album thumbnails then went onto staging alone, without their albums' crops, for Moses to compare. He found them a mixed bag, Gallery 2's photo sometimes the better and sometimes not, so all 12 on staging were put back to what production shows, logged in `rethumb-staging.jsonl`, and the script was cut down to crops, leaving the album thumbnails for a closer look of their own. Its dry runs then found 241 crops to write on production, `indianrock04` having been cut by hand there since, and 213 on staging, less the 29 written.

#### Gallery 2's thumbnails traced

Moses asked whether Gallery 2 or Zenphoto held thumbnail crops the moves had not carried, and what else might have been left behind. Each database's dump was read for every field the gallery could hold, and compared with the AWS scan, and then with production through its API.

- **Zenphoto's crops**, in `thumbX` to `thumbH`: 421, all carried, as [Gallery 2's thumbnails](#gallery-2s-thumbnails) says.
- **Gallery 2's crops**: its `g2_Derivative` rows of type 1 are thumbnails, and 269 of the photos' begin with `crop|x,y,w,h`, in percent, every one a square on the image it was cut from. 26 of the photos have a crop on AWS, cut again in Zenphoto near Gallery 2's; production has none on the other 243. Gallery 2's shape and production's agree within 0.2% for all but `carols4`.
- **Gallery 2's album thumbnails**: an album's thumbnail is a derivative of the photo it is shown by. For 397 day albums that photo could be followed to production: 264 show it, 121 show one picked since, 119 of them the thumbnail Zenphoto was told, and 12 show neither. Of the 35 sub-albums the move made into day albums, 10 show it, 19 show what Zenphoto was told, 5 have the photo nowhere, and `shakescene` shows neither, which is the 13th.
- **Gallery 2's rotations**: 118 photos had a turned version of type 3. The 111 turned a quarter are upright on AWS by their sizes, which a quarter turn the wrong way would match too, so the 6 of them with a crop were looked at on production, all upright: `/2008/11-23/clay2`, `/2008/11-29/geocaching12`, `/2009/03-15/geocaching1`, `/2010/06-06/shakescene03`, `/2010/07-11/gymnastic1` and `/2013/05-19/big_trip7`. The 7 turned a half are upright on production by eye: `/2013/11-04/halloween6a`, `halloween6b` and `tiger_lilies`, `/2014/10-26/baseball4` to `6` and `/2014/11-01/facebook6`.
- **Nothing else to bring.** Zenphoto's tags are on AWS for all 7,371 photos that had any. Neither database has a comment, rating, video or custom field. Zenphoto's city, state, country, credit, copyright, GPS and IPTC keywords were read from the files, which the gallery has. Gallery 2's 2.2 million views have no field to go into, its keywords are ten first names, and three of Zenphoto's tags are on albums, which the gallery does not tag.
- `derivatives.jsonl` was written from the dump beside `items.jsonl`, 11,992 rows. `rethumb-gallery2.ts` dry-ran `--all` against staging and production with the same result: 242 crops and 13 thumbnails to write.

#### Gallery 2's orders on staging and production

Moses looked at `/2010/04-18/` on staging against production and said it looks right, and the script had two rounds of review, which added the collision and hand-order guards. `reorder-gallery2.ts` then ran `--to staging --all --go`, 43 orders, and the six albums shown in an order of their own each with `--only`, 6 more: 50 with the first, every one logged with the order it had in `reorder-staging.jsonl`. A rerun of `--all` finds nothing to write. Moses compared the most changed albums on staging with production and called them improvements, and production ran the same way: 44 with `--all --go`, `kingswim4_001` left out of `/2007/07-01/` as culled, then the six by name, logged in `reorder-production.jsonl`; a rerun finds nothing to write, and a guest's read of `/2010/04-18/` and `/2013/06-24/` is in Gallery 2's order. Each write set positions alone, no Images transformations and no R2.

#### Gallery 2's hand orders traced

Moses asked whether Gallery 2 or Zenphoto let him order photos by hand, whether he had, and whether the order came through. Both databases say. Gallery 2's `g2_ItemAttributesMap` holds a weight for every item, and `orderBy = orderWeight` on the 59 albums shown by it, against a site default of `pathComponent`; Zenphoto's `image_sorttype` option is `filename`, two albums have `sort_type = manual` and their 39 images a `sort_order`. Each hand-ordered album's photos were followed through `matches.jsonl` to Zenphoto, through the Zenphoto comparison's renames to AWS, and by name to production's rows, read from D1 with their positions, and the album's order today compared with Gallery 2's.

- **Gallery 2**: 59 albums by hand, 58 in an order other than their names'. Zenphoto kept 6 of the 58, by renames; today 50 of the 56 the gallery has are out of it, 233 of 1,442 photos, 6 of them under the order the copy from AWS wrote to keep AWS's through sanitizing.
- **Zenphoto**: `/2010/01-24/` and `/2015/08-16/`, both kept on AWS by the 2023 move's renames, whose rows carry the dates Zenphoto gave the photos.
- **`reorder-gallery2.ts`** dry-ran against production and staging with the same result but for `/2007/07-01/`, where staging still has `kingswim4_001`, then wrote `/2010/04-18/` on staging: a guest's read lists dnd, soccer, frisbee, bocce and clubpenguin in Gallery 2's order where production lists them by name, and a rerun writes nothing.

#### The rest of Gallery 2 on production

Moses looked the albums, the single photos and the summaries over on staging and said to run production. `recover-gallery2.ts --to production`: a dry run, `/2012/06-22/` alone with `--go`, then `--all --go`, from 00:06 to 00:20 UTC. The same 63 photos in four unpublished albums, `zzzmothersday` in `/2011/05-08/`, 11 summaries and the titles and captions of `jedi05` and `kauai23`, about 190 Images transformations and 112 MB of R2. Verified through the API as staging was, with the same results; `/2008/07-06/` and `/2010/05-16/` still have no summary.

- **Published.** Moses published `/2008/02-02/`, `/2008/02-03/`, `/2008/04-13/` and `/2012/06-22/`; a guest's read of each is a 200.
- **Tatou's photos got their words again.** The script wrote every photo's title and caption on each run, and Tatou's album, published since, was in `--all`. Workers Logs show no edit to its photos between its recovery on 2026-10-01 and this run, so the same words went back on and nothing was lost. The script now writes words in a published album only for the photos it uploads; a rerun for `/2008/01-22/` and `/2011/05-08/` wrote nothing.

### 2026-10-03

#### The rest of Gallery 2 on staging

`recover-gallery2.ts` ran `--to staging`: `/2012/06-22/` alone with `--go`, looked at through the API, then `--all --go`. The three albums and `pk`, 63 photos, and the four single photos, 112 MB, all from Gallery 2's copies, each checked before the run to have the pixel size Gallery 2 recorded. About 200 Images transformations.

- **Verified through the API.** `/2008/02-02/`, `/2008/02-03/`, `/2008/04-13/` and `/2012/06-22/` are unpublished and a guest's read of each is a 404; they hold 20, 11, 24 and 8 photos with Gallery 2's titles, captions and sizes. `/2008/02-02/` is in Gallery 2's order with "PK with Andrea" as its summary, and `/2008/02-03/`'s link to `pk/` is now `/2008/02-02`. The day albums are in name order, by their first photo, with Gallery 2's summary: "Holy Allowance, Batman!" for `/2012/06-22/` and none for the other two. The four single photos are in their published albums, the 13 summaries and two captions and titles on their rows.
- **Two summaries were wrong.** Moses found `/2008/07-06/`'s "Dean in Malaysia" had nothing to do with its photos: it named Gallery 2's sub-album `motrip`, now `/2008/07-04/`, which has it, and `/2010/05-16/`'s "Dean in Chicago" named `chicago`, now `/2010/05-17/`. Both summaries are blank again on staging and off the list. Moses kept `zzzmothersday` and left out `kingswim4_001`, a duplicate of `kingswim4`, whose caption he put on production's `kingswim4` himself, `a_comment_system` and `vincennes2`, which stay on staging.
- **A rerun uploads nothing twice**: the `--all` run found `/2012/06-22/` and Tatou's album holding every photo and uploaded none, and a run for the two captioned photos found their captions there and wrote only their titles, which the first run had not known to.
- **The recovery tests had stopped running.** Moving them to `api/test/unit/recovery/` on 2026-10-02 put them outside the worker project's `test/unit/*.test.ts`, so `npm test` passed without them; the project now takes `test/unit/**/*.test.ts`.

#### Gallery 2 matches rechecked

The Gallery 2 comparison took each photo's first candidate, so a match by name, or by a title of one word such as "Evan", could take another photo's counterpart and push that photo onto a wrong one. `~/dev/tacocat-migration/gallery2/check-matches.mjs` matches them again, writing `matches.jsonl` and `unmatched.jsonl` beside it. Photos at the same path in Zenphoto match first; every other pairing at the same shape is scored by its name, its title and caption, an album within two weeks and a capture time within a day, and the best pairings are taken across all photos at once. A name or a one-word title alone counts only with the place or the time. A last pass takes a caption edited since, most of its words in an album within two weeks. Each photo still unmatched was also looked for on AWS by its caption, and none was there.

- **89 photos unmatched**: the 9 TIFFs, Tatou's 13, and 67 to recover, which are the three albums' 63 and the four single photos in [Gallery 2](#gallery-2).
- **Wrong before**: nine of `pk/`'s photos had matched other classes' portraits by first name, as `circletime-evan.jpg` to `2009/02-09/mk-evan.jpg`; `2008/02-03/crafty1.jpg` matched `2020/04-06/crafty1.jpg`, `2008/04-13/jeremy.jpg` and `milo.jpg` photos of 2008 and 2004, and `2012/06-22/lincoln1.jpg` `2017/03-04/lincoln1.jpg`.
- **Found since**: `2013/07-01/002.JPG` to `088.JPG` are Zenphoto's `paris01.jpg` to `paris28.jpg`, the captions lightly edited, so `046.JPG` and `056.JPG` are `paris14.jpg` and `paris16.jpg`; `2008/07-06/motrip/petronas2.jpg` is `2008/07-04/z-national-petronas2.jpg`.
- **Held**: the class portraits of `2008/10-26/`, `2009/02-09/`, `2009/09-13/k3/`, `2009/10-12/g2/` and `2012/10-29/eb/`, which the first run had paired across years, and `tilden-portraits/`, `photoshoot/`'s JPEGs, `trading-cards/`, `shakescene/` and `motrip/`'s Chinatown photos are all in Zenphoto. These rest on words, shape and dates, not on looking at the photos.

### 2026-10-01

#### Zenphoto has no sub-albums

Moses asked whether Zenphoto had sub-albums, such as `/2010/12-31/some_sub_album`, that the recovery never looked for. It could nest an album folder inside another, and builds its albums from the folders on disk, so both were checked. Of its 1,549 album rows, five lie below a day album, and of the 31,993 files under its `albums/`, seven lie deeper than `year/day/file`: all in the test albums `1993/08-15/test1/` and `2022/11-01/not_for_tacocat/`, which stay behind. The sub-albums that matter are Gallery 2's, which the 2014 move flattened into day albums, losing Tatou's.

#### The 12 stale Zenphoto rows

Each of the 12 rows the Zenphoto comparison could not place is a photo the gallery has under a later name. Their albums' rows were left behind when Moses renamed the album folders in Zenphoto, and these photos were renamed or re-saved at the same time, so no name matched. The nine `academynext` rows rest on identical file sizes; the other five rest on pixel sizes and times alone, and none on looking at a photo. Moses called all twelve closed.

- **`academynext1.jpg` to `academynext9.jpg` are `/2018/07-05/camp01` to `camp09`**, byte for byte: each `Photos/albums/2018/06-29/academynextN.jpg` is the size of S3's `2018/07-05/camp0N.jpg`, eight at 1600×1200 and the ninth at 1280×960, with the same tags. The eight `stanford` photos of `/2018/06-26/` are others, 1280×960 and from two days earlier.
- **`ofranda1.jpg` and `ofranda2.jpg` are `/2018/11-05/ofranda1a` and `ofranda2a`**, 3648×5472 like them, written to Zenphoto on 2018-11-06, the day of the stale rows.
- **`zalva2.jpg` gave way to `/2020/05-18/zalva2b`**, taken at 17:23:56 on 2020-05-17 where `zalva2` was taken at 17:24:25: the next frame of the same moment, chosen instead.
- **`bird_watchers9.jpg` is `/2022/01-17/bird_watchers9_birds`**, cropped from 2251 to 2141 pixels wide and written to Zenphoto 80 minutes after the stale row.
- **`fancy.jpg` is `/2022/01-09/caviar`**: the stale row says it was taken on 2022-01-05 at 19:24:41, and `Photos/raw/2022/01-09/caviar.arw` was written at 2022-01-06 03:24 UTC, the same minute in California. `/2022/02-07/fancy1` is another photo, taken on 2022-01-28.

#### Tatou's Weekend with Felix

Moses found the link: `/2008/01-21/`'s description points at `tatou/`, Gallery 2's sub-album `2008/01-21/tatou`, "Tatou's Weekend with Felix", which no later gallery has. `recover-gallery2.ts` brought it back as `/2008/01-22/`, where Moses said it belongs and where Dropbox keeps its 13 originals, on staging and then production, unpublished, and pointed the link in `/2008/01-21/` at it.

- **Words and order from Gallery 2**: its album title as the summary, as the 2014 move made the others, each photo's title and caption unescaped, and the photos in the order of Gallery 2's weights, which is not the order of their names. The album's own "Return to January 21, 2008" link, `../`, became `/2008/01-21`.
- **Files from Dropbox**, 44.5 MB, each the full-size original of Gallery 2's 1024-pixel copy: every one has its copy's shape, which is the check that `1bikes.jpg`, `3croissants.jpg` and `4breakfast.jpg` are `bikes.jpg`, `croissants.jpg` and `breakfast.jpg`. `breakfast` and `piano` are 640×480 in both, taken by Felix.
- **Verified through the API** on both: unpublished, a guest's read a 404, 13 photos in Gallery 2's order with its words.
- **An upload was dropped on production.** `breakfast`, 79 KB, reached the inbox at 17:15 UTC and no Workflow instance was ever made for it: the Worker logged `upload_redelivered` for its version id, which is what it logs when creating the instance returns nothing, taken to mean the id exists already, and acked the message. No instance has that id, and no error was recorded, so the upload would never have been processed. The script uploaded the photo again under a new id on its next run; the first file is still in the inbox. With `hail16` that is two of about 161 uploads to production failing today, in two ways, and none of about 161 to staging.

#### Zenphoto drafts on production

Moses looked the albums over on staging and said to run production. A dry run, `/1977/12-31/` alone with `--go`, then `--all --go`, from 08:07 to 08:12 UTC, clear of the DebugBear runs: the same 11 albums and 147 photos, unpublished, about 440 Images transformations and 669 MB of R2. Verified through the API as staging was, with the same results.

- **One upload took 12 minutes.** `/2023/01-10/hail16`, 12 MB and 6000×4000, was in the inbox and its Workflow instance started within a second, but the step that stores the photo and makes its derived images ran until the Workflow's 10-minute step timeout, with no error of its own, and the retry took 2 minutes more, where the album's other photos took seconds. The Worker recorded no upload error, since the step had not spent its retries. Nothing says which call inside the step hung.
- **The script gave up first.** It waits 5 minutes for an album's uploads, so it stopped on `hail16` before writing the album's titles, thumbnail and order. A rerun for `/2023/01-10/` once the photo was in wrote them. The first rerun rule would have left the thumbnail unwritten, since it wrote one only for an album the run made or added to; the script now writes an album's thumbnail and order until the album is published.

#### Zenphoto drafts on staging

`recover-zenphoto.ts` ran against `wrangler dev` for `/2007/01-07/` and `/2019/09-14/`, then `--to staging`: `/1977/12-31/` alone with `--go`, looked at through the API, then `--all --go`. The 11 albums and their 147 photos, 669 MB, went from Dropbox through the laptop in 4 minutes, 4 uploads at a time, none refused.

- **Files.** 136 from `Photos/albums` and the 11 of `2015/03-25/` from `Photos/raw`, each read with `rclone cat` and checked against the size Dropbox lists. About 440 Images transformations on staging, the pipeline's three for each photo.
- **Verified through the API.** Every album is unpublished, a guest's read of it is a 404 and a guest's search does not find its photos; each has Zenphoto's summary, description and thumbnail, and its photos in name order, which is the order AWS would have shown. All 147 photos have Zenphoto's title and caption, and 145 its size. `/2023/01-10/hail09` and `hail17` are 4000×6000 here and 6000×4000 in Zenphoto, which recorded the raw pixels of a photo its EXIF orientation turns upright.
- **Text.** Translated as the 2023 move had: against the 30,608 photos and 1,426 albums AWS has not edited since, the move turned `&apos;` and `&nbsp;` into their characters in captions and left the other entities, decoded `&amp;` too in titles, and made `#` links paths.
- **Tags** are not written by the script: the pipeline reads them from each file's XMP keywords, and on `wrangler dev` those were Zenphoto's tags for all 6 photos of `/2019/09-14/`. On staging an admin's search for "turo" finds the 15 photos of the two 2019 albums.
- **One crop.** `/2007/01-07/thejoyces` is the only photo of the 147 with a thumbnail cut in Zenphoto, which the script writes; Zenphoto's crops are in pixels of the image, as 375 photos the move took show.
- **Thumbnails.** Six albums name theirs. The other five hold `1` in Zenphoto, for whichever photo comes first, and are shown by their first photo.
- **Low resolution.** The 12 photos of `2008/12-07/` are 1024 pixels wide, `2007/01-07/torin.jpg` 1280×960, and `2009/05-16/yosemite03.jpg` and `yosemite14.jpg` 1600×1200. `Photos/raw` has nothing from 2006 to 2012, and no larger file of those names is in either folder near their dates; `Photos/albums/2006/11-01/torin.jpg`, 2.9 MB, may be the same photo or another.

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
