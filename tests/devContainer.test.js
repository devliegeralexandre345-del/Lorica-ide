// tests/devContainer.test.js
//
// Coverage for the docker-run command builder used when the user clicks
// the .devcontainer.json badge in the StatusBar (Wave 8). The hook
// itself can't be tested without React, but the command construction is
// pure and is the bit most likely to subtly break across platforms.

import { describe, it, expect } from 'vitest';
import { buildDockerRunCommand } from '../src/hooks/useDevContainer.js';

describe('buildDockerRunCommand', () => {
  it('returns null when image is missing', () => {
    expect(buildDockerRunCommand({ projectPath: '/x' })).toBeNull();
    expect(buildDockerRunCommand({ image: '', projectPath: '/x' })).toBeNull();
  });

  it('returns null when projectPath is missing', () => {
    expect(buildDockerRunCommand({ image: 'node:20' })).toBeNull();
    expect(buildDockerRunCommand({ image: 'node:20', projectPath: '' })).toBeNull();
  });

  it('produces a valid docker run with default workspaceFolder', () => {
    const cmd = buildDockerRunCommand({ image: 'node:20', projectPath: '/home/me/proj' });
    expect(cmd).toBe(
      'docker run --rm -it -v "/home/me/proj:/workspaces/repo" -w "/workspaces/repo" node:20 bash'
    );
  });

  it('uses the workspaceFolder declared in the config', () => {
    const cmd = buildDockerRunCommand({
      image: 'python:3.12',
      projectPath: '/home/me/proj',
      workspaceFolder: '/code',
    });
    expect(cmd).toContain('-v "/home/me/proj:/code"');
    expect(cmd).toContain('-w "/code"');
  });

  it('normalises Windows backslashes to forward slashes', () => {
    const cmd = buildDockerRunCommand({
      image: 'mcr.microsoft.com/devcontainers/base:bullseye',
      projectPath: 'C:\\Users\\me\\proj',
    });
    // Docker for Windows accepts forward-slash paths and they're safer
    // inside the quoted -v argument than escaped backslashes.
    expect(cmd).toContain('-v "C:/Users/me/proj:/workspaces/repo"');
    expect(cmd).not.toContain('\\\\');
  });

  it('escapes embedded double quotes in the project path', () => {
    const cmd = buildDockerRunCommand({
      image: 'alpine',
      projectPath: '/weird "name"/proj',
    });
    expect(cmd).toContain('-v "/weird \\"name\\"/proj:/workspaces/repo"');
  });

  it('preserves the image tag verbatim', () => {
    const cmd = buildDockerRunCommand({
      image: 'ghcr.io/owner/image:sha-abc1234',
      projectPath: '/p',
    });
    expect(cmd).toContain(' ghcr.io/owner/image:sha-abc1234 bash');
  });
});
