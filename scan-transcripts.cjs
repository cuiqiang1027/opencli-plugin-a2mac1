/**
 * scan-transcripts.cjs
 *
 * Scans a Claude Code transcript JSONL file and tallies the leading command
 * (+ first subcommand) for every Bash tool_use invocation.
 *
 * Usage: node scan-transcripts.cjs
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const TRANSCRIPT = path.resolve(
  'C:/Users/CQ/.claude/projects/C--WINDOWS-system32/b2a5414f-9d69-4e1a-bbbb-3511f3f9df88.jsonl'
);
const TOP_N = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip outer quotes from a string if both leading and trailing match.
 * Handles single quotes, double quotes, and backtick quotes.
 */
function stripQuotes(s) {
  s = s.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`')
    ) {
      const inner = s.slice(1, -1);
      if (!inner.includes(first)) {
        return inner;
      }
    }
  }
  return s;
}

/**
 * Given a raw command string, extract the first "token" that is the actual
 * executable name, and optionally the first subcommand token that follows it.
 *
 * Handles:
 *   - Leading env-var assignments: KEY=value KEY2=val2 cmd ...
 *   - sudo / timeout / MSYS_NO_PATHCONF=1 prefixes
 *   - Pipes, &&, ||, ; -- stop at those
 *   - Quotes and backticks around the command
 *
 * Returns [command, subcommand] where subcommand may be null.
 */
function extractCommandPair(raw) {
  let s = raw.trim();
  if (!s) return ['(empty)', null];

  // ----- Phase 1: Strip leading env-var assignments (KEY=val) -----
  const envVarRe = /^([A-Za-z_]\w*)=(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)\s+/;
  let changed = true;
  while (changed) {
    changed = false;
    const m = s.match(envVarRe);
    if (m) {
      s = s.slice(m[0].length);
      changed = true;
    }
  }

  // Also catch lone env var at the start (edge case where no space before value)
  const loneEnvRe = /^([A-Za-z_]\w*)=(\S+)/;
  const loneMatch = s.match(loneEnvRe);
  if (loneMatch) {
    s = s.slice(loneMatch[0].length).trimStart();
  }

  // ----- Phase 2: Strip leading "sudo", "timeout", "nohup" wrappers -----
  const wrapperTokens = new Set(['sudo', 'timeout', 'nohup', 'nice', 'env', 'ltrace', 'strace']);
  changed = true;
  while (changed) {
    changed = false;
    const firstWordMatch = s.match(/^(\S+)/);
    if (firstWordMatch && wrapperTokens.has(firstWordMatch[1])) {
      s = s.slice(firstWordMatch[0].length).trimStart();
      changed = true;
    }
  }

  // ----- Phase 3: Get the first "real" token -----
  const tokens = splitRespectingQuotes(s);
  if (tokens.length === 0) return ['(empty)', null];

  let cmd = tokens[0];

  // Strip leading path components (e.g. ./node_modules/.bin/npm -> npm)
  const cmdBasename = path.basename(cmd);
  if (cmdBasename && cmd !== '.' && cmd !== '..') {
    cmd = cmdBasename;
  }

  // ----- Phase 4: Get subcommand (second token, if it looks like a subcommand) -----
  let sub = null;
  if (tokens.length > 1) {
    const second = stripQuotes(tokens[1]);
    if (
      second &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(second) &&
      !second.startsWith('-')
    ) {
      sub = second;
    }
  }

  return [cmd, sub];
}

/**
 * Split a string by whitespace, keeping quoted substrings intact.
 */
function splitRespectingQuotes(s) {
  const result = [];
  let current = '';
  let inQuote = null;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === '\\' && inQuote === '"') {
      escape = true;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      if (inQuote === ch) {
        inQuote = null;
      } else if (inQuote === null) {
        inQuote = ch;
      }
      current += ch;
      continue;
    }

    if (inQuote === null && /\s/.test(ch)) {
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

/**
 * Produce a display key from the command + subcommand pair.
 */
function makeKey(cmd, sub) {
  if (sub) {
    return `${cmd} ${sub}`;
  }
  return cmd;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(TRANSCRIPT)) {
    console.error(`ERROR: Transcript file not found: ${TRANSCRIPT}`);
    process.exit(1);
  }

  console.error(`Reading: ${TRANSCRIPT}`);

  const data = fs.readFileSync(TRANSCRIPT, 'utf8');
  const lines = data.split('\n').filter((l) => l.trim().length > 0);

  const freq = new Map();
  let totalBashCalls = 0;
  let parseErrors = 0;

  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }

    // Only process assistant messages
    if (obj.type !== 'assistant') continue;

    const msg = obj.message;
    if (!msg || msg.role !== 'assistant') continue;

    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const entry of content) {
      if (!entry || entry.type !== 'tool_use') continue;
      if (entry.name !== 'Bash' && entry.name !== 'PowerShell') continue;

      const input = entry.input;
      if (!input || !input.command) continue;

      totalBashCalls++;

      const rawCmd = input.command;
      const [cmd, sub] = extractCommandPair(rawCmd);
      const key = makeKey(cmd, sub);

      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }

  // Additionally skip entries that aren't real commands
  const skipNoise = new Set([
    // shell comments and built-in keywords
    '#', 'for', 'while', 'until', 'if', 'then', 'else', 'elif', 'fi',
    'do', 'done', 'case', 'esac', 'function', 'select', 'time',
    // bare flags (likely parsing artifact)
    '-w', '-n', '-c', '-r', '-f', '-d', '-e', '-x',
  ]);

  // Sort descending by count
  const sorted = [...freq.entries()]
    .filter(([key]) => {
      // Split on first space and check the base command against skipNoise
      const spaceIdx = key.indexOf(' ');
      const baseCmd = spaceIdx === -1 ? key : key.slice(0, spaceIdx);
      return !skipNoise.has(baseCmd);
    })
    .sort((a, b) => b[1] - a[1]);

  // Print report
  console.log('\n' + '='.repeat(70));
  console.log('  Bash Command Frequency Report');
  console.log('='.repeat(70));
  console.log(`  Total Bash/PowerShell tool_use calls : ${totalBashCalls}`);
  console.log(`  Unique command keys                 : ${freq.size}`);
  if (parseErrors > 0) {
    console.log(`  JSON parse errors skipped            : ${parseErrors}`);
  }
  console.log('='.repeat(70));
  console.log('');

  console.log(
    '  #'.padStart(4) +
      '  Count'.padStart(6) +
      '  %       Command + Subcommand'
  );
  console.log('  ' + '-'.repeat(60));

  const top = sorted.slice(0, TOP_N);
  top.forEach(([key, count], idx) => {
    const pct = ((count / totalBashCalls) * 100).toFixed(1);
    console.log(
      `  ${String(idx + 1).padStart(2)}` +
        `  ${String(count).padStart(5)}` +
        `  ${pct.padStart(5)}%   ${key}`
    );
  });

  console.log('');
  console.log('='.repeat(70));
  if (sorted.length > TOP_N) {
    console.log(`  ... and ${sorted.length - TOP_N} more unique command keys not shown.`);
  }
}

main();
