# The web app

How `web/` is built and how its code is written. It is a SvelteKit single-page app in Svelte 5 and strict TypeScript, with no server-side rendering: `npm run build --workspace web` writes static files that the Worker serves, and everything runs in the browser. How it is built, the browser floor and the guest bundle check are The web app in `Development.md`; how it is tested, The web app in `Testing.md`.

## What it values

- **Speed for guests.** Most readers are guests, unauthenticated and read-only, and the app is judged by how fast an album appears for them. Svelte was chosen in part for its small download; the album cache, the preloads and keeping admin code out of a guest's download all serve this.
- **Few dependencies.** Every runtime dependency adds download weight for guests and another thing to break on upgrade, so a library has to add a lot to get in. When one must, prefer one with no dependencies of its own and a small minified size. A guest's page loads `immer`, `idb-keyval` and a toast library; the rich text editor, the drag and crop libraries and the passkey library are an admin's alone, and `web/guest-bundle.ts` lists them so a guest's page cannot reach them.
- **Not for search engines.** The gallery is public but not meant to be found, so every page carries `noindex` (`web/src/app.html`) on top of the Worker's headers (`Auth.md`), and there is no SEO work: nothing ships that only a crawler would read.

## Routes

| Route                                  | Page                                              |
| -------------------------------------- | ------------------------------------------------- |
| `/`                                    | the root album, the list of years                 |
| `/[year=year]`                         | a year album                                      |
| `/[year=year]/[day=day]`               | a day album, the day as `MM-DD`                   |
| `/[year=year]/[day=day]/[media=media]` | a photo or video                                  |
| `.../[media=media]/crop`               | an admin choosing a media item's thumbnail crop   |
| `/search`, `/search/[terms]`           | search                                            |
| `/login`, `/invite/[token]`            | passkey login, and registering one from an invite |

The matchers in `web/src/params/` hold each segment to the path grammar in `shared/src/paths.ts`. A route's `+page.ts` starts the fetches its page needs, with `albumLoadMachine.fetch()` or `searchStore.search()`, and returns the paths or the query, not the data. A page below the root also fetches its parent album, whose children give the previous and next links; the root fetches the current year, for its latest album.

A route's `+page.svelte` reads the album from the store and hands it to a routing component, such as `DayAlbumRouting`, which shows the loading, error or processing view by the album's status, or else the page. In edit mode it imports the edit page instead.

Validate a path with the predicates and builders `shared/` exports, such as `isAlbumPath` and `albumPath`, never a regex of your own.

## Stores

State lives in classes in `*.svelte.ts` files under `web/src/lib/stores/`, using runes, `$state` and `$derived`, never Svelte's older stores. Each is exported as a singleton. There is no state machine library: the ones evaluated weighed more than the pattern below.

A store's methods come in two kinds:

- **State transition methods** are the only way its state changes. They are synchronous, return `void` and return at once; work such as a fetch they start fire-and-forget, calling an async method with `void` and no `await`. They are the store's public surface, with the state's `$derived` fields.
- **Service methods** do the work: fetch, write to IndexedDB, call the API. They are private and async, never assign state themselves, and finish by calling a transition method. Since nothing awaits them, each catches its own errors and reports them as state, guarding with `e instanceof Error` since a caught value is `unknown`.

A store holds its state in a `#`-private `$state` field and exposes it as a public `$derived` of it, as `SessionStore` does with `#isAdmin` and `isAdmin`; private members always use `#`, never `_` or the `private` keyword. Deriveds have been writable since Svelte 5.25, so this is a convention rather than a guarantee. A keyed collection is a `SvelteMap` from `svelte/reactivity`, with no `$state` around it, which would do nothing; a plain `Map` is not reactive.

`AlbumState` is the exception: a plain container of shared state, every album and every admin operation in progress keyed by path, which the machines write to directly. An entry in one of its maps is replaced whole, never changed in place, since a `SvelteMap` does not see changes inside its values.

The admin machines, for upload, create, rename, delete, reorder, album thumbnails, crop, drafts and edit mode, live in `web/src/lib/stores/admin/`, apart from the guest's stores, so that a guest page reading `AlbumState` does not pull in the code that changes it.

An error message names what it was about, as in `Invalid album path [${path}]`, and a failed admin request reports the Worker's message, which `serverMessage` and `failureMessage` in `web/src/lib/utils/adminApi.ts` read.

## Albums are cached

`AlbumLoadMachine` serves an album from the fastest place that has it and refreshes it from the Worker behind the reader's back:

1. **Memory.** An album already in `AlbumState` shows at once, and the Worker is asked again in the background.
2. **IndexedDB**, through `idb-keyval`. An album found there shows at once, and the Worker is asked again.
3. **The Worker.** A new album goes into memory first, so the reader sees it soonest, then to IndexedDB. A 404 removes the album from both. Any other failure keeps the cached copy and marks the reload failed.

So a revisited album shows instantly and a reader who loses the network still sees what they saw last. Readers arrive from an email at a day album or a photo, so those pages' headers in `web/static/_headers` preload the albums they fetch, and the request is under way before the app runs. The app's `fetch` uses the browser's default cache mode, which is what lets it take the preloaded response.

## Models

`web/src/lib/models/` holds the app's own view of albums and media, pure data with no fetching or persistence. The shapes the Worker sends and IndexedDB keeps are `shared/`'s record types, re-exported by `models/impl/server.ts`; `AlbumCreator` and `GalleryItemCreator` turn a record into the class for its kind, root, year or day album, image or video. The interfaces in `GalleryItemInterfaces.ts` are what components see. Enum members are `SCREAMING_SNAKE_CASE`.

## Components

`web/src/lib/components/` has three kinds:

- **`pages/`**, by domain: album, media, image, video, search, auth. The routing components and the loading, error and processing views live here beside the pages they choose between; a page takes what its route hands it and composes the site's components.
- **`site/`**: the layout, header, navigation, thumbnails and icons, composed by pages. They take everything as props and know nothing of the stores, except for those under `site/admin/`, which drive the admin machines.
- **`data-aware/`**: components that fetch their own data. It is empty, and should stay so: data is fetched by the route and passed down.

Data flows down as props and back up as callback props. Components never talk to each other directly; what two of them share goes through a store, which each reads through `$derived`. Content is passed in as a `Snippet` and rendered with `{@render children?.()}`.

**A guest downloads no admin code.** An admin component reaches a guest's page only through a dynamic import in the markup, such as `{#await import('./MediaPageFullScreenDropZone.svelte') then { default: FullScreenDropZone }}`, behind a check that an admin is logged in; `web/guest-bundle.ts` fails the build when a static import lets one through.

Conventions, for components under `web/src/lib/components/`:

- A component opens with an HTML comment holding `@component` and a sentence on what it is for.
- Its props are an `interface Props`, destructured from `$props()` with defaults, a doc comment on any prop whose name does not say enough.
- File names are PascalCase, ending in `Page`, `Layout` or `Icon` for a page, a layout or an icon, as `AlbumErrorPage.svelte`, `SiteLayout.svelte`, `HomeIcon.svelte`. Variables and functions are camelCase, CSS classes kebab-case.
- A component does one thing. Most are under 50 lines; one past 75 is worth splitting.
- Styles go in the component's own `<style>` block. Site-wide colours and borders are custom properties, and `hidden-sm` and `hidden-xs` the responsive helpers, all in `web/src/lib/styles/global.css`.
