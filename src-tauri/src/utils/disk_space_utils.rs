use crate::error::{AppError, Result};
use log::{debug, error, info, warn};
use std::path::Path;
use sysinfo::Disks;

/// Disk space information
#[derive(Debug, Clone)]
pub struct DiskSpaceInfo {
    /// Available space in bytes
    pub available_bytes: u64,
    /// Total space in bytes
    pub total_bytes: u64,
    /// Used space in bytes (calculated)
    pub used_bytes: u64,
}

impl DiskSpaceInfo {
    /// Get available space in human readable format
    pub fn available_human(&self) -> String {
        format_bytes(self.available_bytes)
    }

    /// Get total space in human readable format
    pub fn total_human(&self) -> String {
        format_bytes(self.total_bytes)
    }

    /// Get used space in human readable format
    pub fn used_human(&self) -> String {
        format_bytes(self.used_bytes)
    }

    /// Check if there's enough space for the required bytes with a buffer
    pub fn has_enough_space(&self, required_bytes: u64, buffer_percentage: f64) -> bool {
        let buffer_bytes = (required_bytes as f64 * buffer_percentage) as u64;
        let total_required = required_bytes + buffer_bytes;
        self.available_bytes >= total_required
    }
}

/// Utility for checking disk space
pub struct DiskSpaceUtils;

impl DiskSpaceUtils {
    /// Get disk space information for a given path
    pub async fn get_disk_space<P: AsRef<Path>>(path: P) -> Result<DiskSpaceInfo> {
        let path = path.as_ref();
        debug!("Getting disk space for path: {:?}", path);

        if let Some(info) = Self::try_sysinfo(path) {
            return Ok(info);
        }

        debug!("sysinfo failed for {:?}, trying statvfs fallback", path);

        if let Some(info) = Self::try_statvfs(path) {
            return Ok(info);
        }

        let error_msg = format!("No disk found for path: {:?}", path);
        error!("{}", error_msg);
        Err(AppError::Other(error_msg))
    }

    fn try_sysinfo(path: &Path) -> Option<DiskSpaceInfo> {
        let disks = Disks::new_with_refreshed_list();

        let mut target_disk = None;
        let mut longest_match = 0;

        for disk in disks.list() {
            let mount_point = disk.mount_point();
            if path.starts_with(mount_point) {
                let match_length = mount_point.as_os_str().len();
                if match_length > longest_match {
                    longest_match = match_length;
                    target_disk = Some(disk);
                }
            }
        }

        let disk = target_disk?;
        let available = disk.available_space();
        let total = disk.total_space();

        if total == 0 || available > total {
            debug!(
                "sysinfo matched mount {:?} for {:?} but reported total={} available={}; deferring to statvfs",
                disk.mount_point(),
                path,
                total,
                available
            );
            return None;
        }

        debug!(
            "sysinfo matched disk for {:?} via mount {:?}: {} available / {} total",
            path,
            disk.mount_point(),
            format_bytes(available),
            format_bytes(total)
        );

        Some(DiskSpaceInfo {
            available_bytes: available,
            total_bytes: total,
            used_bytes: total.saturating_sub(available),
        })
    }

    fn try_statvfs(path: &Path) -> Option<DiskSpaceInfo> {
        let mut search_path = Some(path);
        while let Some(current) = search_path {
            if let Some(info) = Self::statvfs_single(current) {
                debug!(
                    "statvfs succeeded for {:?}: {} available / {} total",
                    current,
                    format_bytes(info.available_bytes),
                    format_bytes(info.total_bytes)
                );
                return Some(info);
            }
            search_path = current.parent();
        }
        None
    }

    #[cfg(unix)]
    fn statvfs_single(path: &Path) -> Option<DiskSpaceInfo> {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let c_path = CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        let result = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };

        if result != 0 {
            debug!(
                "statvfs failed for {:?}: {}",
                path,
                std::io::Error::last_os_error()
            );
            return None;
        }

        let block_size = if stat.f_frsize > 0 {
            stat.f_frsize as u64
        } else {
            stat.f_bsize as u64
        };

        let total_bytes = (stat.f_blocks as u64).saturating_mul(block_size);
        let available_bytes = (stat.f_bavail as u64).saturating_mul(block_size);
        let free_bytes = (stat.f_bfree as u64).saturating_mul(block_size);
        let used_bytes = total_bytes.saturating_sub(free_bytes);

        if total_bytes == 0 {
            debug!("statvfs returned 0 total bytes for {:?}", path);
            return None;
        }

        Some(DiskSpaceInfo {
            available_bytes,
            total_bytes,
            used_bytes,
        })
    }

    #[cfg(not(unix))]
    fn statvfs_single(_path: &Path) -> Option<DiskSpaceInfo> {
        None
    }

    /// Check if there's enough space for a download with buffer
    pub async fn check_space_for_download<P: AsRef<Path>>(
        path: P,
        required_bytes: u64,
        buffer_percentage: f64,
    ) -> Result<bool> {
        let space_info = Self::get_disk_space(path).await?;
        let has_space = space_info.has_enough_space(required_bytes, buffer_percentage);

        if has_space {
            info!(
                "Disk space check passed: {} available, {} required (+{}% buffer)",
                space_info.available_human(),
                format_bytes(required_bytes),
                (buffer_percentage * 100.0) as u32
            );
        } else {
            warn!(
                "Insufficient disk space: {} available, {} required (+{}% buffer)",
                space_info.available_human(),
                format_bytes(required_bytes),
                (buffer_percentage * 100.0) as u32
            );
        }

        Ok(has_space)
    }

    /// Check space and return detailed error if insufficient
    pub async fn ensure_space_for_download<P: AsRef<Path>>(
        path: P,
        required_bytes: u64,
        buffer_percentage: f64,
    ) -> Result<()> {
        let path = path.as_ref();
        let space_info = Self::get_disk_space(path).await?;

        if !space_info.has_enough_space(required_bytes, buffer_percentage) {
            let buffer_bytes = (required_bytes as f64 * buffer_percentage) as u64;
            let total_required = required_bytes + buffer_bytes;
            let shortfall = total_required - space_info.available_bytes;

            let error_msg = format!(
                "Insufficient disk space on {:?}. Required: {} (+{}% buffer = {}), Available: {}, Shortfall: {}",
                path,
                format_bytes(required_bytes),
                (buffer_percentage * 100.0) as u32,
                format_bytes(total_required),
                space_info.available_human(),
                format_bytes(shortfall)
            );

            error!("{}", error_msg);
            return Err(AppError::InsufficientDiskSpace {
                path: path.to_path_buf(),
                required_mb: total_required / 1024 / 1024,
                available_mb: space_info.available_bytes / 1024 / 1024,
                shortfall_mb: shortfall / 1024 / 1024,
            });
        }

        Ok(())
    }
}

/// Format bytes in human readable format
fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    
    if bytes == 0 {
        return "0 B".to_string();
    }
    
    let mut size = bytes as f64;
    let mut unit_index = 0;
    
    while size >= 1024.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }
    
    if unit_index == 0 {
        format!("{} {}", bytes, UNITS[unit_index])
    } else {
        format!("{:.1} {}", size, UNITS[unit_index])
    }
}

#[cfg(test)]
#[path = "disk_space_utils_test.rs"]
mod tests; 