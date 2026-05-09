// src/hooks/useDevContainer.js
//
// Detects .devcontainer/devcontainer.json on project change and exposes
// a `openShell` action that drops the user into a docker shell inside
// the declared image. Read-only first pass per V2.3_ROADMAP.md — no
// build step, no compose orchestration, no port forwarding.

import { useEffect, useState, useCallback } from 'react';

// Build the `docker run` command that mounts the user's project at the
// container's workspace folder. Pure function — exported for tests so
// the quoting / cross-platform path normalisation stays pinned.
//
// Quoting: POSIX-style double quotes around both halves of `-v` so a
// project path with spaces survives the sub-shell. On Windows we
// normalise backslashes to forward slashes because Docker for Windows
// accepts them and `\\` is fragile inside a quoted argument.
export function buildDockerRunCommand({ image, projectPath, workspaceFolder }) {
  if (!image || !projectPath) return null;
  const workspace = workspaceFolder || '/workspaces/repo';
  const safePath = String(projectPath).replace(/\\/g, '/').replace(/"/g, '\\"');
  return `docker run --rm -it -v "${safePath}:${workspace}" -w "${workspace}" ${image} bash`;
}

export function useDevContainer(projectPath, dispatch) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  // Refresh whenever the active project changes. Failures are silent —
  // most projects don't have a devcontainer.json and the badge just stays
  // hidden.
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    if (!projectPath) return undefined;
    setLoading(true);
    (async () => {
      try {
        const r = await window.lorica.devcontainer?.detect(projectPath);
        if (!cancelled && r?.success) setInfo(r.data || null);
      } catch {} finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath]);

  const openShell = useCallback(async () => {
    if (!info?.image) {
      dispatch?.({
        type: 'ADD_TOAST',
        toast: {
          type: 'warning',
          message: info?.composeFile
            ? 'Compose-based devcontainer — open a shell with `docker compose run` manually for now.'
            : info?.hasBuild
            ? 'Build-based devcontainer — Lorica v2.3 doesn’t run builds yet.'
            : 'No `image` field in devcontainer.json — nothing to launch.',
          duration: 4500,
        },
      });
      return;
    }
    // Make sure the terminal panel is open so the user sees the shell.
    dispatch?.({ type: 'SET_PANEL', panel: 'showTerminal', value: true });
    // Spawn a fresh terminal session, then write the docker command into
    // it. The image is mounted at the workspaceFolder declared in the
    // config (default `/workspaces/<repo-name>` per the spec). We use the
    // user's project root as the bind-mount source so files edited inside
    // the container land back on disk.
    const cmd = buildDockerRunCommand({
      image: info.image,
      projectPath,
      workspaceFolder: info.workspaceFolder,
    });
    try {
      const create = await window.lorica.terminal.create();
      const sessionId = create?.success ? create.data : null;
      // Even when create fails (no PTY), we want to surface why — toast
      // lets the user diagnose rather than guessing what happened.
      if (sessionId == null) {
        dispatch?.({
          type: 'ADD_TOAST',
          toast: { type: 'error', message: `Could not open terminal session (${create?.error || 'unknown error'})`, duration: 5000 },
        });
        return;
      }
      // Small delay so the shell finishes printing its prompt before we
      // type the docker command.
      setTimeout(() => {
        try { window.lorica.terminal.write(cmd + '\n', sessionId); } catch {}
      }, 120);
      dispatch?.({
        type: 'ADD_TOAST',
        toast: {
          type: 'info',
          message: `Launching ${info.image} in a new terminal — first run pulls the image.`,
          duration: 3500,
        },
      });
    } catch (e) {
      dispatch?.({
        type: 'ADD_TOAST',
        toast: { type: 'error', message: `Devcontainer shell failed: ${e?.message || e}`, duration: 4500 },
      });
    }
  }, [info, projectPath, dispatch]);

  return { info, loading, openShell };
}
