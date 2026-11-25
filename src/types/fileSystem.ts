// Types for file system operations

/**
 * Represents a node in a file system tree
 * Maps to the Rust FileNode struct in path_utils.rs
 */
export interface FileNode {
    /** Name of the file or directory (just the filename, not the full path) */
    name: string;
    
    /** Full path to the file or directory */
    path: string;
    
    /** Whether this node is a directory */
    is_dir: boolean;
    
    /** Child nodes (empty for files) */
    children?: FileNode[];
    
    /** File size in bytes (0 for directories) */
    size: number;
    
    /** Last modified timestamp as seconds since UNIX epoch */
    last_modified: number | null;
}
