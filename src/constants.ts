export const PI_SESSIONS_DIR = ".pi/agent/sessions";
export const MODEL_DIR = ".pi-doctor";
export const MODEL_FILE = "model.json";
export const GUIDANCE_FILE = "guidance.md";

export const SENTINEL_CUSTOM_TOKENS = {
  undo: -3,
  revert: -3,
  wrong: -3,
  incorrect: -3,
  rollback: -3,
  "start over": -4,
  "try again": -2,
  "not what i": -4,
  "that's not": -3,
  "thats not": -3,
  "already told": -4,
  "i said": -3,
  "just do": -2,
  broken: -2,
  "doesn't work": -3,
  "doesnt work": -3,
  "not working": -3,
  "still broken": -4,
  "keep going": -1,
  fail: -2,
  failed: -2,
  retry: -1
};

export const INTERRUPT_PATTERN = /\[Request interrupted by user/i;

export const META_MESSAGE_PATTERNS = [
  /^<system-reminder>/i,
  /^<task-notification/i,
  /^<skill/i,
  /^\/task\b/i,
  /^\/review\b/i,
  /^\/help\b/i,
  /^```/
];

export const EDIT_TOOL_NAMES = [
  "edit",
  "multiedit",
  "write",
  "replace",
  "str_replace",
  "insert_content",
  "write_to_file",
  "edit_file"
];

export const READ_TOOL_NAMES = [
  "read",
  "view",
  "grep",
  "rg",
  "glob",
  "search",
  "find",
  "ls",
  "list_files",
  "search_files",
  "read_file"
];

export const CORRECTION_PATTERNS = [
  /^no[,.!\s]/i,
  /^nope/i,
  /^wrong/i,
  /^that'?s not/i,
  /^not what i/i,
  /^i (said|meant|asked|wanted)/i,
  /^actually[,\s]/i,
  /^wait[,\s]/i,
  /^stop/i,
  /^instead[,\s]/i,
  /^don'?t do that/i,
  /^why did you/i
];

export const KEEP_GOING_PATTERNS = [
  /^keep going/i,
  /^continue/i,
  /^keep at it/i,
  /^more$/i,
  /^finish/i,
  /^go on/i,
  /^don'?t stop/i,
  /^you'?re not done/i,
  /^not done/i,
  /^keep iterating/i
];
