/**
 * Side-effect CSS imports (`import "./hero.css"`) carry no types. Vite handles
 * them for Storybook and the catalog; tsc needs to be told they resolve. In a
 * customer's project the file sits next to the component, installed by the same
 * registry item, so the same relative import keeps working.
 */
declare module '*.css';
