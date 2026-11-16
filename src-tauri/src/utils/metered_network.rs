use log::debug;

pub async fn is_metered() -> bool {
    match detect().await {
        Ok(metered) => metered,
        Err(e) => {
            debug!("[Network] Could not tell whether the connection is metered: {}", e);
            false
        }
    }
}

#[cfg(windows)]
async fn detect() -> Result<bool, String> {
    use windows::Networking::Connectivity::{NetworkCostType, NetworkInformation};

    tauri::async_runtime::spawn_blocking(|| {
        let cost_type = NetworkInformation::GetInternetConnectionProfile()
            .and_then(|profile| profile.GetConnectionCost())
            .and_then(|cost| cost.NetworkCostType())
            .map_err(|e| e.to_string())?;
        Ok(matches!(cost_type, NetworkCostType::Fixed | NetworkCostType::Variable))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "linux")]
async fn detect() -> Result<bool, String> {
    const METERED_YES: u32 = 1;
    const METERED_GUESS_YES: u32 = 3;

    let connection = zbus::Connection::system().await.map_err(|e| e.to_string())?;
    let proxy = zbus::Proxy::new(
        &connection,
        "org.freedesktop.NetworkManager",
        "/org/freedesktop/NetworkManager",
        "org.freedesktop.NetworkManager",
    )
    .await
    .map_err(|e| e.to_string())?;
    let metered: u32 = proxy.get_property("Metered").await.map_err(|e| e.to_string())?;
    Ok(matches!(metered, METERED_YES | METERED_GUESS_YES))
}

#[cfg(not(any(windows, target_os = "linux")))]
async fn detect() -> Result<bool, String> {
    Ok(false)
}
