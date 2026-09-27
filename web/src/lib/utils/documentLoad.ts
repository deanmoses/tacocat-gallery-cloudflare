/**
 * Loads `path` as a new document rather than navigating within the app. The app asks who is logged in once per
 * document, and what it has read, such as search results, depends on who that was; so a change of session starts
 * over.
 */
export function loadDocument(path: string): void {
    location.assign(path);
}
