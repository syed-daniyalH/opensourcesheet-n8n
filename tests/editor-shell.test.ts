import assert from "node:assert/strict";
import test from "node:test";
import { renderEditorShell, withLightTheme } from "../src/editor-shell.js";

test("forces the embedded Grist document to use the light theme", () => {
  assert.equal(
    withLightTheme("/doc/Blank-document?foo=bar#table"),
    "/doc/Blank-document?foo=bar&themeAppearance=light&themeSyncWithOs=false#table",
  );
  assert.equal(
    withLightTheme("/doc/Blank-document?themeAppearance=dark&themeSyncWithOs=true"),
    "/doc/Blank-document?themeAppearance=light&themeSyncWithOs=false",
  );
});

test("renders the configured document with the light-theme parameters", () => {
  const html = renderEditorShell("/doc/Blank-document");
  assert.match(html, /src="\/doc\/Blank-document\?themeAppearance=light&themeSyncWithOs=false"/);
  assert.match(html, /class="editor-chrome"/);
});
