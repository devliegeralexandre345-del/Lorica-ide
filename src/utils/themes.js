import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Each theme declares a 5-stop `logoBars` palette used by LoricaLogo.
// Colours go top-bar → bottom-bar, following the brand gradient pattern
// (image 2 reference): a bright hue in the widest top bar fading into a
// lighter, more transparent-feeling hue at the narrow bottom. Each
// theme expresses that pattern in its own colour family so the logo
// recolours with the rest of the UI instead of looking stuck on the
// default purple-to-cyan.
export const THEMES = {
  midnight: {
    name: 'Midnight',
    bg: '#0a0e17',
    surface: '#111827',
    panel: '#1a2236',
    border: '#1e2d4a',
    accent: '#00d4ff',
    text: '#e2e8f0',
    textDim: '#64748b',
    logoBars: ['#00d4ff', '#4ac8ff', '#7fb7f5', '#a8a5e3', '#cfb0d8'],
  },
  hacker: {
    name: 'Hacker Green',
    bg: '#0a0f0a',
    surface: '#0f1a0f',
    panel: '#132013',
    border: '#1a3a1a',
    accent: '#00ff41',
    text: '#c8e6c9',
    textDim: '#5a7a5a',
    logoBars: ['#00ff41', '#4aff78', '#87f0a0', '#b0e2c4', '#d2f0dc'],
  },
  arctic: {
    name: 'Arctic Light',
    bg: '#0d1b2a',
    surface: '#1b2838',
    panel: '#1f3044',
    border: '#2a4158',
    accent: '#64b5f6',
    text: '#e3f2fd',
    textDim: '#607d8b',
    logoBars: ['#64b5f6', '#8bc5f7', '#acd0f8', '#c8e0f7', '#e0ecf9'],
  },
  forge: {
    name: 'Forge',
    bg: '#09050a',
    surface: '#130d0a',
    panel: '#1e1208',
    border: '#3a1f05',
    accent: '#ff7800',
    text: '#f5e6d0',
    textDim: '#6b4020',
    logoBars: ['#ff7800', '#ff9628', '#ffb350', '#ffd080', '#ffe4b0'],
  },
  spectre: {
    // The brand theme — `logoBars` here matches the reference image 2
    // (magenta → periwinkle → pale cyan). Same palette is baked into
    // `src-tauri/icons/logo.svg` for OS-level icons which can't read
    // theme CSS vars.
    name: 'Spectre',
    bg: '#060410',
    surface: '#0e0820',
    panel: '#160c30',
    border: '#2d1a50',
    accent: '#a855f7',
    text: '#ede8ff',
    textDim: '#5a3a8a',
    logoBars: ['#b878f5', '#9c89f0', '#8eb3ed', '#7fd2ec', '#bfeff6'],
  },
  steel: {
    name: 'Steel',
    bg: '#080c10',
    surface: '#0f1620',
    panel: '#172030',
    border: '#1e2e40',
    accent: '#94c4f0',
    text: '#e8f0f8',
    textDim: '#3a4a5a',
    logoBars: ['#94c4f0', '#a8cef2', '#bed9f4', '#d3e3f6', '#e7eef8'],
  },
};

export function createEditorTheme(themeName) {
  const t = THEMES[themeName] || THEMES.midnight;
  
  const editorTheme = EditorView.theme({
    '&': { backgroundColor: t.bg, color: t.text },
    '.cm-content': { caretColor: t.accent },
    '.cm-cursor': { borderLeftColor: t.accent },
    '.cm-gutters': { backgroundColor: t.bg, color: t.textDim, borderRight: `1px solid ${t.border}` },
    '.cm-activeLineGutter': { backgroundColor: t.panel, color: t.accent },
    '.cm-activeLine': { backgroundColor: `${t.panel}80` },
    '.cm-selectionBackground': { backgroundColor: `${t.accent}25` },
    '.cm-matchingBracket': { backgroundColor: `${t.accent}30`, color: t.accent },
    '.cm-searchMatch': { backgroundColor: `${t.accent}30` },
    '.cm-tooltip': { backgroundColor: t.surface, border: `1px solid ${t.border}`, color: t.text },
    '.cm-tooltip-autocomplete': { backgroundColor: t.surface },
  }, { dark: true });

  const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: '#c792ea' },
    { tag: tags.string, color: '#c3e88d' },
    { tag: tags.number, color: '#f78c6c' },
    { tag: tags.comment, color: '#546e7a', fontStyle: 'italic' },
    { tag: tags.function(tags.variableName), color: '#82aaff' },
    { tag: tags.typeName, color: '#ffcb6b' },
    { tag: tags.className, color: '#ffcb6b' },
    { tag: tags.definition(tags.variableName), color: '#eeffff' },
    { tag: tags.propertyName, color: '#80cbc4' },
    { tag: tags.operator, color: '#89ddff' },
    { tag: tags.bool, color: '#ff5370' },
    { tag: tags.null, color: '#ff5370' },
    { tag: tags.meta, color: '#ffcb6b' },
    { tag: tags.tagName, color: '#f07178' },
    { tag: tags.attributeName, color: '#c792ea' },
    { tag: tags.attributeValue, color: '#c3e88d' },
    { tag: tags.regexp, color: '#89ddff' },
    { tag: tags.bracket, color: '#89ddff' },
    { tag: tags.angleBracket, color: '#89ddff' },
    { tag: tags.paren, color: '#89ddff' },
  ]);

  return [editorTheme, syntaxHighlighting(highlightStyle)];
}
