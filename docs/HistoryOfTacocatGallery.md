# History of the Tacocat Gallery

The gallery has run on seven systems in 25 years, and each move left something behind. This is what each one was, when, and where its remains are, as worked out in September 2026 from what is still at DreamHost, the Internet Archive's index of `tacocat.com`, Moses' Dropbox and his memory. What each move lost, and what comes back, is in [Recovering lost content from pre-AWS galleries](plans/RecoverPreAwsGalleries.md).

| Years                 | System                 | Address                                                                | Where it is now                                                    |
| --------------------- | ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1999 to 2001          | Bare folders of photos | `tacocat.com/pix/1999-06/` and the like                                | `~/tacocat.com/pix/1999/` at DreamHost                             |
| December 2001 to 2004 | LView Pro Web Gallery  | `tacocat.com/pix/2002.4.2-4.15/` and the like, later `pix/2002/04/02/` | `~/tacocat.com/pix/2001/` to `2004/`                               |
| 2005 to 2006          | JAlbum                 | `tacocat.com/pix/2005/11/27/`                                          | `~/tacocat.com/pix/2005/` and `2006/`                              |
| January 2007 to 2014  | Gallery 2              | `tacocat.com/pictures/`                                                | MySQL `pictures`, files in `~/g2data/albums/`                      |
| November 2014 to 2023 | Zenphoto               | `tacocat.com/zenphoto/`, with front ends in `p/`, `p2/`, `p3/`         | MySQL `tacocatzenphoto`, files in `~/tacocat.com/zenphoto/albums/` |
| December 2023 to 2026 | AWS                    | `pix.tacocat.com`                                                      | The four AWS repos beside this one                                 |
| 2026                  | Cloudflare             |                                                                        | This repo                                                          |

## Before the gallery

`tacocat.com` began as Moses' personal site: the Internet Archive has its pages from 1998, guides to ActiveX, pages on CNET and New York, and pages about Lucie and friends. Photos went up from 1999 as bare folders under `pix/`, `pix/1999-06/`, `pix/1999-10/halloween/`, which the web server listed as it lists any folder, with no pages or captions. They are at DreamHost as `pix/1999/06/` and `pix/1999/10/`, and most are in the gallery's 1999 albums.

## The weekly albums: LView Pro, December 2001 to 2004

The gallery proper began with Felix, born in December 2001. Each week got an album, its title the week of his life, "Week 22, May 7-13, 2002", and its folder named for the week's dates, `pix/2001.12.17-23/`, `pix/2002.4.2-4.15/`. Each album led back to "the main Felix page", `tacocat.com/felix/`. LView Pro, a Windows image editor, made each album with its Web Gallery feature: an album page with the week's story and a table of thumbnails, `index.htm`; a page per photo with its caption and Previous, Up and Next buttons, in `html/`; the photos at 640 pixels in `images/`; and thumbnails in `thumbnails/`. Every page carries its `<meta name="generator" content="LView(R) Pro Web Gallery">`.

From May 2002 a new camera took video. No version of the gallery played video until AWS in January 2026, so Moses cut each clip down to a small MPEG, uploaded it to a `video/` folder beside the album and linked it from the album's story: "See this week's videos." The camera's originals went into Dropbox's `Photos/raw/…/not_for_tacocat/video/` folders, `not_for_tacocat` being what was not published to the site.

## JAlbum, 2005 to 2006

From 2005 the albums were made with JAlbum, David Ekholm's Java desktop program, which turns a folder of photos into a web album through a skin of templates. The pages name no generator, but their layout is JAlbum's, an `index.html` with `slides/`, `thumbs/` and `res/` folders, and they keep its templates' comments, such as "Include header.inc from the source image directory if present" and "Image, maybe with link to original", which JAlbum's skin guide quotes. Their look and CSS classes, `thumbnail-cell`, `returntoindex-text`, are no stock skin's, so the skin was most likely Moses' own. One album, `2006/01/08/`, also holds pages from two stock skins, BluPlusPlus and Exhibit Plus by Mark Fyvie, which look tried and set aside. Each year had a page of its albums, `pix/2005/index.php`, and the albums had an RSS feed through FeedBurner.

## Gallery 2, January 2007 to 2014

On 2007-01-09 the gallery moved to Gallery 2, Menalto's PHP and MySQL gallery, at `tacocat.com/pictures/`, version 2.3.1 by the end. Gallery 2 took its first albums that day, and the same day `pix/` was rearranged: the weekly folders became `pix/YYYY/MM/DD/` and the JAlbum albums were regenerated, which is why every file in `pix/` is dated 2007-01-09. The static albums stayed up, and Gallery 2 held the albums from 2007 on. Its albums were day folders, `2008/01-13/`, with sub-albums inside some, `2009/05-17/yosemite/`, and most photos were uploaded as copies 1024 or 640 pixels on the long side. The Everybody group's view permission said what the public saw. `pix/index.html` was later pointed at `/pictures/v/2014/`.

In September 2013 Moses tried Gallery 3, in the database `tacocat_gallery3`, and Piwigo, at `themosii.com`, and dropped both after a day.

## Zenphoto, November 2014 to 2023

On 2014-11-23 Piwigo was tried once more, and the same day the gallery started moving to Zenphoto, version 1.6 by the end, at `tacocat.com/zenphoto/`. Gallery 2's albums were copied over in November and December 2014, its sub-albums becoming day albums of their own, `2009/05-17/yosemite/` becoming `2009/05-16/`, and the full-size originals replacing Gallery 2's copies. The albums before 2007, back to scans of 1918, came into Zenphoto too, so for the first time one system held the whole gallery. Zenphoto marked unpublished albums as hidden, which is how drafts were kept.

Readers saw Zenphoto through front ends of Moses' own: `tacocat.com/p/`, from 2014, `p2/` from 2017 to 2018, and in January 2022 `p3/` and a first SvelteKit app, which read the albums from Zenphoto; `p_json/` holds the gallery as a JSON file per year. The SvelteKit app became the one the AWS gallery served, and `prod-pix.tacocat.com` and `dev-pix.tacocat.com` at DreamHost still serve builds of it from 2023.

## AWS, December 2023 to 2026

On 2023-12-13 the files were copied from Zenphoto into S3 and every published album and photo written to DynamoDB, and the gallery moved to `pix.tacocat.com` on AWS: the SvelteKit app on S3 and CloudFront, Lambdas behind API Gateway, Cognito for login and Redis for search, from four repos. The drafts were left behind. Video arrived in January 2026, transcoded by MediaConvert.

## Cloudflare, 2026

This repo, filled from AWS by [Migrating the AWS gallery data](plans/AwsDataMigration.md) and from what the earlier moves left behind by [Recovering lost content from pre-AWS galleries](plans/RecoverPreAwsGalleries.md).

## What each move left behind

- **Gallery 2 to Zenphoto, 2014.** Three albums, `2008/02-03/`, `2008/04-13/` and `2012/06-22/`, a dozen photos, two captions and 13 album summaries. Every file is still in `~/g2data/albums/`.
- **The static gallery to everything after.** About 218 photos and 40 of its 42 videos, which no later gallery took, and 40 photos of the 1999 folders. The rearrangement of 2007 lost one photo, `2001.12.24-31/pumping.jpg`.
- **Zenphoto to AWS, 2023.** The 11 albums unpublished in Zenphoto, 147 photos, and one unpublished photo. The files reached S3 without rows.

## Where the originals are

Moses' originals are in two Dropbox folders, `Photos/albums` for the published albums and `Photos/raw` for the camera's raws and the unpublished, `not_for_tacocat` among them. They are a starting point, not the truth: albums online were renamed, added to, pruned and moved after they were published from them. At DreamHost, `~/tacocat.com/` also holds two folders that were never part of the gallery: `felix/`, Felix's page, and `giraffe/`, two sound recordings of 2011.
