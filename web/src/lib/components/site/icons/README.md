# Icons

Most icons are from [Entypo+](http://www.entypo.com), on its 20-unit grid: Create, Crop, Delete, Home, Login, Logout, Rename, Reorder (`swap`, turned upright and thickened), Unpublished, Upload and Waiting.

The rest come from elsewhere, on larger grids: Cancel, Edit, Next, Prev, Return, Save, Search and the stars. Play is drawn by hand.

Each icon sets its size and its place against the text through its `viewBox`, since `Icon.svelte` draws every icon in the same 1em box: crop the `viewBox` to make the glyph larger, and start it above the glyph to move it down. A glyph that fills its grid's full height can't move down inside its box without being clipped, so it lowers the whole box with `Icon`'s `bottom` instead, as Reorder does.
