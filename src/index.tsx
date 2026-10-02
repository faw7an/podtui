import { render } from "ink";
import { App } from "./ui/App.tsx";

/**
 * `alternateScreen: true` keeps scrollback clean and restores the previous
 * screen on exit. Ink performs the enter/exit sequences and the cursor
 * restore itself, symmetrically, including on unmount — verified in
 * docs/DECISIONS.md, so we do not hand-roll the escapes.
 */
render(<App />, { alternateScreen: true });