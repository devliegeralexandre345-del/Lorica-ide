import { useCallback } from 'react';
import { pushRecentProject } from '../utils/recentProjects';

export function useFileSystem(dispatch) {
  // Open a project by an already-known path. Used by session restore to
  // re-open the last project on boot without prompting the user with a
  // dialog. Returns true on success.
  const openProject = useCallback(async (folderPath) => {
    if (!folderPath) return false;
    const result = await window.lorica.fs.readDir(folderPath);
    if (result.success) {
      dispatch({ type: 'SET_PROJECT', path: folderPath, tree: result.data });
      dispatch({ type: 'SET_STATUS', message: `Opened: ${folderPath}` });
      window.lorica.security.addAuditEntry('PROJECT_OPEN', folderPath);
      // MRU-track so "Recent projects" always surfaces real work.
      pushRecentProject(folderPath);
      return true;
    }
    return false;
  }, [dispatch]);

  const openFolder = useCallback(async () => {
    const folderPath = await window.lorica.dialog.openFolder();
    if (!folderPath) return;
    await openProject(folderPath);
  }, [openProject]);

  const refreshTree = useCallback(async (projectPath) => {
    if (!projectPath) return;
    const result = await window.lorica.fs.readDir(projectPath);
    if (result.success) {
      dispatch({ type: 'SET_FILE_TREE', tree: result.data });
    }
  }, [dispatch]);

  // `opts.line` (1-indexed) tells the editor to scroll the file to that
  // line after opening. Used by semantic-search hits, Problems panel,
  // Agent references, etc.
  const openFile = useCallback(async (filePath, opts = {}) => {
    const result = await window.lorica.fs.readFile(filePath);
    if (result.success) {
      dispatch({
        type: 'OPEN_FILE',
        file: {
          path: filePath,
          name: result.data.name,
          content: result.data.content,
          extension: result.data.extension,
          dirty: false,
          pendingGoto: opts.line ? { line: opts.line } : null,
        },
      });
      // Scan for secrets
      const scan = await window.lorica.security.scanForSecrets(result.data.content);
      if (scan.success && scan.data.length > 0) {
        dispatch({ type: 'SET_SECURITY_ALERTS', alerts: scan.data });
      } else {
        dispatch({ type: 'SET_SECURITY_ALERTS', alerts: [] });
      }
    }
  }, [dispatch]);

  const saveFile = useCallback(async (file, index) => {
    const result = await window.lorica.fs.writeFile(file.path, file.content);
    if (result.success) {
      dispatch({ type: 'MARK_FILE_SAVED', index });
      dispatch({ type: 'SET_STATUS', message: `Saved: ${file.name}` });
      window.lorica.security.addAuditEntry('FILE_SAVE', file.path);
    }
  }, [dispatch]);

  const createNewFile = useCallback(async (dirPath, fileName) => {
    const fullPath = `${dirPath}/${fileName}`;
    const result = await window.lorica.fs.createFile(fullPath);
    if (result.success) {
      return fullPath;
    }
    return null;
  }, []);

  const createNewDir = useCallback(async (dirPath, dirName) => {
    const fullPath = `${dirPath}/${dirName}`;
    const result = await window.lorica.fs.createDir(fullPath);
    if (result.success) {
      return fullPath;
    }
    return null;
  }, []);

  const deletePath = useCallback(async (targetPath) => {
    const result = await window.lorica.fs.deletePath(targetPath);
    return result.success;
  }, []);

  const renamePath = useCallback(async (oldPath, newPath) => {
    const result = await window.lorica.fs.rename(oldPath, newPath);
    return result.success;
  }, []);

  return { openFolder, openProject, refreshTree, openFile, saveFile, createNewFile, createNewDir, deletePath, renamePath };
}

