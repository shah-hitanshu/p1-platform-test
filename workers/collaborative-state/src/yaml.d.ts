// Ambient type declaration for .yaml module imports.
// Wrangler's Text rule (wrangler.jsonc) loads these as raw strings at bundle time.
declare module '*.yaml' {
  const content: string;
  export default content;
}
