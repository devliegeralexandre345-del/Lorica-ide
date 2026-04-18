/**
 * loricaBridge.js — Tauri 2 Bridge
 * 
 * Creates window.lorica with the exact same API as Electron's preload.js.
 * Uses proper npm imports for Tauri 2 plugins.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog';

// ============================================
// Safe invoke wrapper
// ============================================
async function safeInvoke(cmd, args = {}) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    console.error(`[Lorica] ${cmd} failed:`, e);
    return { success: false, error: String(e) };
  }
}

// ============================================
// Window Controls
// ============================================
const appWindow = getCurrentWindow();

const windowControls = {
  minimize: () => appWindow.minimize(),
  maximize: async () => {
    if (await appWindow.isMaximized()) {
      appWindow.unmaximize();
    } else {
      appWindow.maximize();
    }
  },
  close: () => appWindow.close(),
};

// ============================================
// File System
// ============================================
const fs = {
  readDir: (dirPath) => safeInvoke('cmd_read_dir', { dirPath }),
  readFile: (filePath) => safeInvoke('cmd_read_file', { filePath }),
  readFileBytes: (filePath) => safeInvoke('cmd_read_file_bytes', { filePath }),
  writeFile: (filePath, content) => safeInvoke('cmd_write_file', { filePath, content }),
  createFile: (filePath) => safeInvoke('cmd_create_file', { filePath }),
  createDir: (dirPath) => safeInvoke('cmd_create_dir', { dirPath }),
  deletePath: (targetPath) => safeInvoke('cmd_delete_path', { targetPath }),
  rename: (oldPath, newPath) => safeInvoke('cmd_rename', { oldPath, newPath }),
  stat: (filePath) => safeInvoke('cmd_stat', { filePath }),
  exists: (filePath) => safeInvoke('cmd_exists', { filePath }),
  // Start/stop the project file watcher. Emits `fs:change` events via
  // @tauri-apps/api/event. Idempotent on the same path.
  watchProject: (path) => safeInvoke('cmd_watch_project', { path }),
  unwatchProject: () => safeInvoke('cmd_unwatch_project'),
};

// ============================================
// Dialogs — uses @tauri-apps/plugin-dialog
// ============================================
const dialog = {
  openFolder: async () => {
    try {
      const selected = await dialogOpen({
        directory: true,
        multiple: false,
      });
      return selected || null;
    } catch (e) {
      console.error('[Lorica] openFolder failed:', e);
      return null;
    }
  },
  openFile: async () => {
    try {
      const selected = await dialogOpen({
        multiple: false,
        filters: [
          { name: 'Source Code', extensions: ['js', 'jsx', 'ts', 'tsx', 'rs', 'py', 'cpp', 'h', 'html', 'css', 'json', 'md', 'sql', 'toml', 'yaml', 'yml'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      return selected || null;
    } catch (e) {
      console.error('[Lorica] openFile failed:', e);
      return null;
    }
  },
  saveFile: async (defaultPath) => {
    try {
      const selected = await dialogSave({ defaultPath });
      return selected || null;
    } catch (e) {
      console.error('[Lorica] saveFile failed:', e);
      return null;
    }
  },
};

// ============================================
// Security Vault
// ============================================
const security = {
  initVault: (masterPassword) => safeInvoke('cmd_init_vault', { masterPassword }),
  unlockVault: (masterPassword) => safeInvoke('cmd_unlock_vault', { masterPassword }),
  lockVault: () => safeInvoke('cmd_lock_vault'),
  addSecret: (key, value) => safeInvoke('cmd_add_secret', { key, value }),
  getSecret: (key) => safeInvoke('cmd_get_secret', { key }),
  deleteSecret: (key) => safeInvoke('cmd_delete_secret', { key }),
  listSecrets: () => safeInvoke('cmd_list_secrets'),
  isVaultInitialized: () => safeInvoke('cmd_is_vault_initialized'),
  isVaultUnlocked: () => safeInvoke('cmd_is_vault_unlocked'),
  getAuditLog: () => safeInvoke('cmd_get_audit_log'),
  addAuditEntry: (action, detail) => safeInvoke('cmd_add_audit_entry', { action, detail }),
  scanForSecrets: (code) => safeInvoke('cmd_scan_for_secrets', { code }),
};

// ============================================
// Terminal — uses @tauri-apps/api/event for listen
// ============================================
let terminalUnlisten = null;

const terminal = {
  create: () => safeInvoke('cmd_terminal_create'),
  write: (data) => safeInvoke('cmd_terminal_write', { data }),
  resize: (cols, rows) => safeInvoke('cmd_terminal_resize', { cols, rows }),
  kill: () => safeInvoke('cmd_terminal_kill'),
  runCommand: (command, cwd) => safeInvoke('cmd_run_command', { command, cwd }),
  onData: async (callback) => {
    // Clean up previous listener
    if (terminalUnlisten) {
      terminalUnlisten();
      terminalUnlisten = null;
    }
    try {
      terminalUnlisten = await listen('terminal:data', (event) => {
        callback(event.payload);
      });
    } catch (e) {
      console.error('[Lorica] terminal listen failed:', e);
    }
  },
  removeDataListener: () => {
    if (terminalUnlisten) {
      terminalUnlisten();
      terminalUnlisten = null;
    }
  },
};

// ============================================
// Helix Buffer (large files)
// ============================================
const buffer = {
  openLargeFile: (filePath) => safeInvoke('cmd_open_large_file', { filePath }),
  getLines: (filePath, startLine, endLine) => safeInvoke('cmd_get_lines', { filePath, startLine, endLine }),
  insertText: (filePath, offset, text) => safeInvoke('cmd_insert_text', { filePath, offset, text }),
  deleteRange: (filePath, offset, length) => safeInvoke('cmd_delete_range', { filePath, offset, length }),
  getLineCount: (filePath) => safeInvoke('cmd_get_line_count', { filePath }),
};

// ============================================
// Global Search
// ============================================
const search = {
  searchInFiles: (projectPath, query, caseSensitive, maxResults) =>
    safeInvoke('cmd_search_in_files', { projectPath, query, caseSensitive, maxResults }),
  replaceInFiles: (projectPath, query, replacement, caseSensitive) =>
    safeInvoke('cmd_search_replace_in_files', { projectPath, query, replacement, caseSensitive }),
  listProjectFiles: (projectPath) =>
    safeInvoke('cmd_list_project_files', { projectPath }),

  // Semantic search — embeddings-based. First build is slow (downloads the
  // ONNX model + embeds the repo), queries after that are ~10–50 ms.
  // Subsequent builds are incremental: unchanged files are kept as-is,
  // only modified/new files get re-embedded. Pass `force: true` to nuke
  // the manifest and re-embed everything.
  semanticIndex: (projectPath, force) =>
    safeInvoke('cmd_semantic_index_project', { projectPath, force: !!force }),
  semanticIndexStatus: (projectPath) =>
    safeInvoke('cmd_semantic_index_status', { projectPath }),
  semanticSearch: (projectPath, query, topK) =>
    safeInvoke('cmd_semantic_search', { projectPath, query, topK }),
  semanticIndexClear: (projectPath) =>
    safeInvoke('cmd_semantic_index_clear', { projectPath }),
};

// ============================================
// Git
// ============================================
const git = {
  status: (projectPath) => safeInvoke('cmd_git_status', { projectPath }),
  stage: (projectPath, filePath) => safeInvoke('cmd_git_stage', { projectPath, filePath }),
  unstage: (projectPath, filePath) => safeInvoke('cmd_git_unstage', { projectPath, filePath }),
  stageAll: (projectPath) => safeInvoke('cmd_git_stage_all', { projectPath }),
  commit: (projectPath, message) => safeInvoke('cmd_git_commit', { projectPath, message }),
  push: (projectPath) => safeInvoke('cmd_git_push', { projectPath }),
  pull: (projectPath) => safeInvoke('cmd_git_pull', { projectPath }),
  log: (projectPath, count) => safeInvoke('cmd_git_log', { projectPath, count }),
  diff: (projectPath, filePath) => safeInvoke('cmd_git_diff', { projectPath, filePath }),
  branches: (projectPath) => safeInvoke('cmd_git_branches', { projectPath }),
  checkout: (projectPath, branch) => safeInvoke('cmd_git_checkout', { projectPath, branch }),
  discard: (projectPath, filePath) => safeInvoke('cmd_git_discard', { projectPath, filePath }),
  diffStaged: (projectPath) => safeInvoke('cmd_git_diff_staged', { projectPath }),
  // Consolidated call — returns { status, log, branches } in a single IPC
  // round-trip with the 3 git subprocesses running in parallel.
  summary: (projectPath, opts = {}) => safeInvoke('cmd_git_summary', {
    projectPath,
    logCount: opts.logCount ?? 20,
    includeLog: opts.includeLog ?? true,
    includeBranches: opts.includeBranches ?? true,
  }),
  // PR context — current branch + commits + diff since branch-off from
  // base. `baseBranch` is optional; backend auto-detects main/master.
  prContext: (projectPath, baseBranch) => safeInvoke('cmd_git_pr_context', {
    projectPath,
    baseBranch: baseBranch || null,
  }),
};

// ============================================
// Extensions & Debug
// ============================================
const extensions = {
  list: () => safeInvoke('cmd_list_extensions'),
  install: (id) => safeInvoke('cmd_install_extension', { id }),
  uninstall: (id) => safeInvoke('cmd_uninstall_extension', { id }),
};

const debug = {
  run: (config) => safeInvoke('cmd_debug_run', { config }),
};

// ============================================
// DAP (Debug Adapter Protocol)
// ============================================
const dap = {
  launch: (config) => safeInvoke('cmd_dap_launch', { config }),
  continue: (sessionId) => safeInvoke('cmd_dap_continue', { sessionId }),
  stepOver: (sessionId, threadId) => safeInvoke('cmd_dap_step_over', { sessionId, threadId }),
  stepIn: (sessionId, threadId) => safeInvoke('cmd_dap_step_in', { sessionId, threadId }),
  stepOut: (sessionId, threadId) => safeInvoke('cmd_dap_step_out', { sessionId, threadId }),
  pause: (sessionId) => safeInvoke('cmd_dap_pause', { sessionId }),
  terminate: (sessionId) => safeInvoke('cmd_dap_terminate', { sessionId }),
  setBreakpoints: (sessionId, file, lines) => safeInvoke('cmd_dap_set_breakpoints', { sessionId, file, lines }),
  getVariables: (sessionId, variablesReference) => safeInvoke('cmd_dap_get_variables', { sessionId, variablesReference }),
  evaluate: (sessionId, expression, frameId) => safeInvoke('cmd_dap_evaluate', { sessionId, expression, frameId }),
  getStackTrace: (sessionId, threadId) => safeInvoke('cmd_dap_get_stack_trace', { sessionId, threadId }),
};

// ============================================
// LSP (Language Server Protocol)
// ============================================
const lsp = {
  start: (options) => safeInvoke('cmd_lsp_start', { options }),
  stop: (sessionId) => safeInvoke('cmd_lsp_stop', { sessionId }),
  request: (sessionId, method, params) => safeInvoke('cmd_lsp_request', { sessionId, method, params }),
  notify: (sessionId, method, params) => safeInvoke('cmd_lsp_notify', { sessionId, method, params }),
  diagnostics: (sessionId) => safeInvoke('cmd_lsp_diagnostics', { sessionId }),
};

// ============================================
// Platform
// ============================================
const platform = navigator.userAgent.includes('Win') ? 'win32'
  : navigator.userAgent.includes('Mac') ? 'darwin'
  : 'linux';

// ============================================
// Expose as window.lorica
// ============================================
window.lorica = {
  window: windowControls,
  fs,
  dialog,
  security,
  terminal,
  buffer,
  search,
  git,
  extensions,
  debug,
  dap,
  lsp,
  platform,
};

console.log(`[Lorica] Bridge ready — platform: ${platform}`);

