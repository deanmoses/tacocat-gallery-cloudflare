// Ambient, so it has no imports: Vite's ?inline gives a file as a data: URL.
declare module '*?inline' {
    const dataUrl: string;
    export default dataUrl;
}
