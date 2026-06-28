import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { LoadingManager } from 'three';
import { logDebug, logInfo, logWarn, logError } from './logging-utils';

/**
 * Extends GLTFLoader to handle Tauri asset:// URLs and resolve relative paths correctly.
 * 
 * This loader intercepts relative resource paths (textures, .bin files) and converts
 * them using convertFileSrc to work with Tauri's asset protocol.
 */
export function extendGLTFLoaderForTauri(loader: GLTFLoader, baseAssetUrl: string): void {
  logInfo(`[TauriGLTFLoader] Extending loader for base URL: ${baseAssetUrl}`);
  
  // Extract the base directory path from the asset URL
  // Example: "http://asset.localhost/C:/Users/.../model.gltf" -> "C:/Users/.../"
  let baseDirPath: string | null = null;
  
  try {
    // Try to extract the actual file path from the asset URL
    const match = baseAssetUrl.match(/asset:\/\/(.+)/) || baseAssetUrl.match(/http:\/\/asset\.localhost\/(.+)/);
    if (match) {
      const encodedPath = match[1];
      baseDirPath = decodeURIComponent(encodedPath);
      logDebug(`[TauriGLTFLoader] Extracted encoded path: ${encodedPath}`);
      logDebug(`[TauriGLTFLoader] Decoded path: ${baseDirPath}`);
      
      // Remove the filename to get the directory
      const lastSlash = Math.max(baseDirPath.lastIndexOf('/'), baseDirPath.lastIndexOf('\\'));
      if (lastSlash !== -1) {
        baseDirPath = baseDirPath.substring(0, lastSlash + 1);
        logInfo(`[TauriGLTFLoader] Base directory path: ${baseDirPath}`);
      } else {
        logWarn(`[TauriGLTFLoader] Could not find directory separator in path: ${baseDirPath}`);
        baseDirPath = null;
      }
    } else {
      logWarn(`[TauriGLTFLoader] Could not match asset URL pattern: ${baseAssetUrl}`);
    }
  } catch (e) {
    logError(`[TauriGLTFLoader] Failed to extract base path: ${e}`);
  }

  // Override the manager's resolveURL to handle relative paths
  const manager = loader.manager;
  const originalResolveURL = manager.resolveURL.bind(manager);
  
  manager.resolveURL = function(url: string): string {
    logDebug(`[TauriGLTFLoader] Resolving URL: ${url}`);
    
    // If it's already an absolute URL (http, https, blob, data), return as-is
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
      logDebug(`[TauriGLTFLoader] Absolute URL detected, using original resolver: ${url}`);
      return originalResolveURL(url);
    }

    // If it's an asset:// URL, return as-is
    if (url.startsWith('asset://') || url.startsWith('http://asset.localhost')) {
      logDebug(`[TauriGLTFLoader] Asset URL detected, using original resolver: ${url}`);
      return originalResolveURL(url);
    }

    // If we have a base directory path and this is a relative path, resolve it
    if (baseDirPath && !url.startsWith('/')) {
      try {
        logDebug(`[TauriGLTFLoader] Resolving relative path: ${url} (base: ${baseDirPath})`);
        
        // Construct the full path
        // Normalize path separators - use backslash for Windows paths
        const normalizedBase = baseDirPath.replace(/\//g, '\\');
        const normalizedUrl = url.replace(/\//g, '\\');
        const fullPath = normalizedBase + normalizedUrl;
        
        logDebug(`[TauriGLTFLoader] Full path constructed: ${fullPath}`);
        
        // Convert to asset URL using convertFileSrc
        const assetUrl = convertFileSrc(fullPath);
        logInfo(`[TauriGLTFLoader] Converted to asset URL: ${assetUrl}`);
        return assetUrl;
      } catch (e) {
        logError(`[TauriGLTFLoader] Failed to resolve relative path ${url}: ${e}`);
        // Fallback to original behavior
        return originalResolveURL(url);
      }
    }

    // Fallback to original behavior
    logDebug(`[TauriGLTFLoader] Using original resolver (fallback): ${url}`);
    return originalResolveURL(url);
  };
  
  logInfo(`[TauriGLTFLoader] Loader extension complete`);
}

