// Corresponds to Architecture enum in Rust
export type JavaArchitecture = 'x86' | 'x64' | 'arm' | 'aarch64' | 'unknown';

/**
 * Represents a detected Java installation.
 * Mirrors the Rust JavaInstallation struct.
 */
export interface JavaInstallation {
  /** Path to the Java executable (e.g., /path/to/java or C:\path\to\java.exe) */
  path: string;
  /** Full Java version string (e.g., "17.0.2") */
  version: string;
  /** Major Java version (e.g., 17) */
  major_version: number; // u32 -> number
  /** Whether this is a 64-bit Java installation */
  is_64bit: boolean;
  /** The Java vendor (e.g., "Oracle", "OpenJDK", "AdoptOpenJDK") */
  vendor: string;
  /** The Java VM name (e.g., "HotSpot", "OpenJ9") */
  vm_name: string | null; // Option<String> -> string | null
  /** How this installation was found (e.g., "PATH", "Launcher Directory", "Windows (C:\Program Files\Java)") */
  source: string;
  /** The architecture of the Java installation */
  architecture: JavaArchitecture;
} 

// this is a test comment