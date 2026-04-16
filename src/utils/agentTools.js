// src/utils/agentTools.js
// Définitions des outils Anthropic pour l'agent Lorica

export const TOOL_PERMISSIONS = {
  read_file:    'canRead',
  list_dir:     'canRead',
  search_files: 'canSearch',
  fetch_url:    'canWeb',
  write_file:   'canWrite',
  create_file:  'canCreate',
  delete_file:  'canDelete',
  run_command:  'canTerminal',
};

// Outils non-destructifs (auto-exécutés sans demande d'approbation)
export const NON_DESTRUCTIVE_TOOLS = new Set(['read_file', 'list_dir', 'search_files', 'fetch_url']);

const ALL_TOOL_DEFS = [
  {
    name: 'read_file',
    description: 'Read the content of a file at the given absolute path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file with new content. Shows a diff to the user before applying.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Full new content of the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the files and subdirectories in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_file',
    description: 'Create a new empty file at the given path. Fails if the file already exists.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path for the new file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory at the given path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command in the project directory and return stdout/stderr.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        cwd: { type: 'string', description: 'Working directory (defaults to project root)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a text pattern across all files in the project.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        case_sensitive: { type: 'boolean', description: 'Whether to search case-sensitively' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch the text content of a URL (documentation, API, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      required: ['url'],
    },
  },
];

/**
 * Returns the subset of tool definitions matching the enabled permissions.
 * @param {object} permissions - { canRead, canWrite, canCreate, canDelete, canTerminal, canSearch, canWeb }
 */
export function buildToolsForPermissions(permissions) {
  return ALL_TOOL_DEFS.filter((tool) => {
    const permKey = TOOL_PERMISSIONS[tool.name];
    return permKey ? permissions[permKey] : true;
  });
}
