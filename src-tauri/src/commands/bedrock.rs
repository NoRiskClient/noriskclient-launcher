use std::fs;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

pub fn find_mcbe_executable(install_dir: &Path) -> Option<PathBuf> {
    let exe_path = install_dir.join("Content").join("Minecraft.Windows.exe");
    if exe_path.exists() {
        return Some(exe_path);
    }

    // fallback: recursive search if needed
    fn search_recursively(dir: &Path) -> Option<PathBuf> {
        for entry in fs::read_dir(dir).ok()? {
            let path = entry.ok()?.path();
            if path.is_dir() {
                if let Some(found) = search_recursively(&path) {
                    return Some(found);
                }
            } else if path.extension().map(|e| e == "exe").unwrap_or(false) {
                let name = path.file_name()?.to_str()?.to_lowercase();
                if name.contains("minecraft") {
                    return Some(path);
                }
            }
        }
        None
    }

    search_recursively(install_dir)
}

#[cfg(target_os = "windows")]
fn get_mcbe_from_registry() -> Option<PathBuf> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let uninstall_paths = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for base in &uninstall_paths {
        if let Ok(key) = hklm.open_subkey(base) {
            for sub in key.enum_keys().flatten() {
                if let Ok(app) = key.open_subkey(&sub) {
                    let name: Option<String> = app.get_value("DisplayName").ok();
                    if let Some(name) = name {
                        if name.to_lowercase().contains("minecraft")
                            && name.to_lowercase().contains("windows")
                        {
                            if let Ok(loc) = app.get_value::<String, _>("InstallLocation") {
                                let p = PathBuf::from(loc);
                                if p.exists() {
                                    return Some(p);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn fallback_scan_mcbe() -> Option<PathBuf> {
    let drives = ('C'..='Z')
        .map(|l| PathBuf::from(format!("{}:\\", l)))
        .filter(|p| p.exists())
        .collect::<Vec<_>>();

    for drive in drives {
        let xbox_root = drive.join("XboxGames");
        if !xbox_root.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(&xbox_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = path.file_name()?.to_str()?.to_lowercase();
                    if name.contains("minecraft") {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
pub fn find_mcbe_install_dir() -> Option<PathBuf> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    #[cfg(target_os = "windows")]
    if let Some(p) = get_mcbe_from_registry() {
        return Some(p);
    }

    #[cfg(target_os = "windows")]
    {
        return fallback_scan_mcbe();
    }

    None
}

#[cfg(not(target_os = "windows"))]
pub fn find_mcbe_install_dir() -> Option<PathBuf> {
    None
}

#[tauri::command]
pub fn launch_mcbe_cmd() -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Minecraft Bedrock is only available on Windows.".into());
    }

    let path = crate::commands::bedrock::find_mcbe_install_dir()
        .ok_or("Minecraft Bedrock installation not found.")?;

    let exe = find_mcbe_executable(&path).ok_or("Minecraft Bedrock executable not found.")?;

    std::process::Command::new("explorer")
        .arg(exe)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn mcbe_installed_cmd() -> bool {
    crate::commands::bedrock::find_mcbe_install_dir().is_some()
}

pub fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

#[tauri::command]
pub fn is_windows_cmd() -> bool {
    is_windows()
}
