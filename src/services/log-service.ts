import { invoke } from "@tauri-apps/api/core";

export const LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export interface ParsedLogLine {
  id: number;
  raw: string;
  timestamp?: string;
  thread?: string;
  level?: LogLevel;
  text: string;
}

// Standard format: [HH:MM:SS] [Thread/Level]: Text
const logLineRegexStandard = /^\s*\[(\d{2}:\d{2}:\d{2})\]\s+\[([^/]+)\/([^\]]+)\]:\s*(.*)$/;
// NeoForge format with source: [Timestamp] [Thread/Level] [Source]: Text
const logLineRegexNeoForgeSource = /^\s*\[([^\]]+)\]\s+\[([^/]+)\/([^\]]+)\]\s+\[[^\]]+\]:\s*(.*)$/;
// NeoForge format without source: [Timestamp] [Thread/Level]: Text
const logLineRegexNeoForgeNoSource = /^\s*\[([^\]]+)\]\s+\[([^/]+)\/([^\]]+)\]:\s*(.*)$/;

/**
 * Stateful log parser that maintains context between parsing calls.
 * Useful for live logs where lines are received incrementally.
 */
export class LogParser {
  private nextId: number = 0;
  private lastKnownLevel: LogLevel | undefined = undefined;
  private lastKnownThread: string | undefined = undefined;

  /**
   * Creates a new LogParser instance
   * @param initialId Optional starting ID for log lines (default: 0)
   */
  constructor(initialId: number = 0) {
    this.nextId = initialId;
  }

  /**
   * Parse log content, maintaining state from previous parsing operations
   * @param rawContent The raw log content to parse
   * @returns Array of parsed log lines
   */
  parseLogContent(rawContent: string): ParsedLogLine[] {
    const linesArray = rawContent.split(/\r?\n/);
    const processedLines: ParsedLogLine[] = [];
  
    for (let i = 0; i < linesArray.length; i++) {
      const line = linesArray[i];
      let match: RegExpMatchArray | null = null;
      let timestamp: string | undefined = undefined;
      let thread: string | undefined = undefined;
      let level: LogLevel | undefined = undefined;
      let text: string = line.trimEnd(); // Default text, trim end
  
      // Try matching standard format
      match = line.match(logLineRegexStandard);
      if (match) {
        timestamp = match[1];
        thread = match[2];
        const levelUpper = match[3].toUpperCase() as LogLevel;
        level = LOG_LEVELS.includes(levelUpper) ? levelUpper : undefined;
        text = match[4].trim(); // Full trim for captured text
        
        // Store these values for potential inheritance by future lines
        this.lastKnownThread = thread;
        if (level) this.lastKnownLevel = level;
      } else {
        // Try matching NeoForge with source format
        match = line.match(logLineRegexNeoForgeSource);
        if (match) {
          timestamp = match[1];
          thread = match[2];
          const levelUpper = match[3].toUpperCase() as LogLevel;
          level = LOG_LEVELS.includes(levelUpper) ? levelUpper : undefined;
          text = match[4].trim(); // Full trim
          
          // Store these values for potential inheritance by future lines
          this.lastKnownThread = thread;
          if (level) this.lastKnownLevel = level;
        } else {
           // Try matching NeoForge without source format
           match = line.match(logLineRegexNeoForgeNoSource);
           if (match) {
              timestamp = match[1];
              thread = match[2];
              const levelUpper = match[3].toUpperCase() as LogLevel;
              level = LOG_LEVELS.includes(levelUpper) ? levelUpper : undefined;
              text = match[4].trim(); // Full trim
              
              // Store these values for potential inheritance by future lines
              this.lastKnownThread = thread;
              if (level) this.lastKnownLevel = level;
           }
        }
      }
  
      if (match) {
        // We found a structured log line
        processedLines.push({
          id: this.nextId++,
          raw: line,
          timestamp: timestamp,
          thread: thread,
          level: level,
          text: text,
        });
      } else {
        // Line does NOT match any known format - inherit level and thread
        // Now specifically handle indented lines like list items
        processedLines.push({
          id: this.nextId++,
          raw: line,
          timestamp: undefined,
          thread: this.lastKnownThread, // Also inherit the thread
          level: this.lastKnownLevel, // Use the last known level
          text: text, // Already trimmed end
        });
      }
    }
    return processedLines;
  }

  /**
   * Reset the parser state
   */
  reset(resetId: boolean = true): void {
    this.lastKnownLevel = undefined;
    this.lastKnownThread = undefined;
    if (resetId) {
      this.nextId = 0;
    }
  }

  /**
   * Get the current parser state
   */
  getState(): { nextId: number; lastLevel: LogLevel | undefined; lastThread: string | undefined } {
    return {
      nextId: this.nextId,
      lastLevel: this.lastKnownLevel,
      lastThread: this.lastKnownThread
    };
  }
}

/**
 * Parses a raw log string into an array of structured log lines.
 * Handles standard Minecraft/Fabric and NeoForge log formats.
 * Inherits log levels for lines that don't match known formats (e.g., stack traces).
 * @param rawContent The raw log content as a single string.
 * @returns An array of ParsedLogLine objects.
 */
export function parseLogLinesFromString(rawContent: string): ParsedLogLine[] {
    const linesArray = rawContent.split(/\r?\n/);
    const processedLines: ParsedLogLine[] = [];
    let lastKnownLevel: LogLevel | undefined = undefined;
    let lastKnownThread: string | undefined = undefined;
  
    for (let i = 0; i < linesArray.length; i++) {
      const line = linesArray[i];
      let match: RegExpMatchArray | null = null;
      let timestamp: string | undefined = undefined;
      let thread: string | undefined = undefined;
      let level: LogLevel | undefined = undefined;
      let text: string = line.trimEnd(); // Default text, trim end
  
      // Try matching standard format
      match = line.match(logLineRegexStandard);
      if (match) {
        timestamp = match[1];
        thread = match[2];
        const levelUpper = match[3].toUpperCase() as LogLevel;
        level = LOG_LEVELS.includes(levelUpper) ? levelUpper : undefined;
        text = match[4].trim(); // Full trim for captured text
        
        // Store these values for potential inheritance by future lines
        lastKnownThread = thread;
        if (level) lastKnownLevel = level;
      } else {
        // Try matching NeoForge with source format
        match = line.match(logLineRegexNeoForgeSource);
        if (match) {
          timestamp = match[1];
          thread = match[2];
          const levelUpper = match[3].toUpperCase() as LogLevel;
          level = LOG_LEVELS.includes(levelUpper) ? levelUpper : undefined;
          text = match[4].trim(); // Full trim
          
          // Store these values for potential inheritance by future lines
          lastKnownThread = thread;
          if (level) lastKnownLevel = level;
        } else {
           // Try matching NeoForge without source format
           match = line.match(logLineRegexNeoForgeNoSource);
           if (match) {
              timestamp = match[1];
              thread = match[2];
              const levelUpper = match[3].toUpperCase() as LogLevel;
              level = LOG_LEVELS.includes(levelUpper) ? levelUpper : undefined;
              text = match[4].trim(); // Full trim
              
              // Store these values for potential inheritance by future lines
              lastKnownThread = thread;
              if (level) lastKnownLevel = level;
           }
        }
      }
  
      if (match) {
        // We found a structured log line
        processedLines.push({
          id: i,
          raw: line,
          timestamp: timestamp,
          thread: thread,
          level: level,
          text: text,
        });
      } else {
        // Line does NOT match any known format - inherit level and thread
        // Now specifically handle indented lines like list items
        processedLines.push({
          id: i,
          raw: line,
          timestamp: undefined,
          thread: lastKnownThread, // Also inherit the thread
          level: lastKnownLevel, // Use the last known level
          text: text, // Already trimmed end
        });
      }
    }
    return processedLines;
  }

// --- New Service Functions ---

/**
 * Fetches the list of log file paths for a given profile.
 * @param profileId The ID of the profile.
 * @returns A promise that resolves to an array of log file paths.
 */
export async function getProfileLogFiles(profileId: string): Promise<string[]> {
    return await invoke<string[]>('get_profile_log_files', { profileId });
}

/**
 * Fetches the raw content of a specific log file.
 * @param logFilePath The full path to the log file.
 * @returns A promise that resolves to the raw string content of the log file.
 */
export async function getLogFileContent(logFilePath: string): Promise<string> {
    return await invoke<string>('get_log_file_content', { logFilePath });
}

/**
 * Uploads log content to mclo.gs.
 * @param logContent The raw log content to upload.
 * @returns A promise that resolves to the URL of the uploaded log.
 */
export async function uploadLogToMclogs(logContent: string): Promise<string> {
    // Ensure the backend command name matches exactly
    return await invoke<string>('upload_log_to_mclogs_command', { logContent });
}

/**
 * Requests the operating system to open the directory containing the specified file path.
 * @param filePath The path to a file within the directory to open.
 * @returns A promise that resolves when the command has been invoked.
 */
export async function openLogFileDirectory(filePath: string): Promise<void> {
    // Ensure the backend command name matches exactly
    await invoke('open_file_directory', { filePath });
}

// --- Debug Tab Service Functions ---

/**
 * File information for log/crash report listings
 */
export interface FileInfo {
  path: string;
  name: string;
  size: number;
  modified: number; // Unix timestamp in seconds
}

/**
 * Lists all launcher log files from the logs directory.
 * @returns A promise that resolves to an array of FileInfo objects.
 */
export async function listLauncherLogs(): Promise<FileInfo[]> {
  return await invoke<FileInfo[]>('list_launcher_logs');
}

/**
 * Lists the 20 most recent crash report files from all profiles.
 * @returns A promise that resolves to an array of FileInfo objects.
 */
export async function listCrashReports(): Promise<FileInfo[]> {
  return await invoke<FileInfo[]>('list_crash_reports');
}

/**
 * Lists the 20 most recent MC log files from all profiles.
 * @returns A promise that resolves to an array of FileInfo objects.
 */
export async function listAllMcLogs(): Promise<FileInfo[]> {
  return await invoke<FileInfo[]>('list_all_mc_logs');
}

export async function listProcessLogs(): Promise<FileInfo[]> {
  return await invoke<FileInfo[]>('list_process_logs');
}
