use super::*;
use crate::minecraft::dto::piston_meta::LoggingFile;

const UNREACHABLE_URL: &str = "http://127.0.0.1:1/client-1.12.xml";
const VANILLA_CONFIG: &str =
    "<Configuration status=\"WARN\"><Appenders><Console><LegacyXMLLayout /></Console></Appenders></Configuration>";
const VANILLA_SHA1: &str = "e4f8ec649099ff42055c2c93ad6757d78eebf9ad";

fn logging_client() -> LoggingClient {
    LoggingClient {
        argument: "-Dlog4j.configurationFile=${path}".to_string(),
        file: LoggingFile {
            id: "client-1.12.xml".to_string(),
            sha1: VANILLA_SHA1.to_string(),
            size: VANILLA_CONFIG.len() as i64,
            url: UNREACHABLE_URL.to_string(),
        },
        logging_type: "log4j2-xml".to_string(),
    }
}

async fn write(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).await.unwrap();
    fs::write(path, content).await.unwrap();
}

#[tokio::test]
async fn mojangs_config_is_kept_verifiable_across_launches() {
    let dir = tempfile::tempdir().unwrap();
    let service = MinecraftLoggingDownloadService::with_path(dir.path().to_path_buf());
    let vanilla_path = dir.path().join("client-1.12.xml");
    write(&vanilla_path, VANILLA_CONFIG).await;

    let first = service
        .download_logging_config(&logging_client())
        .await
        .expect("a config matching the manifest hash must not need the network");
    let second = service
        .download_logging_config(&logging_client())
        .await
        .expect("the hash must still match on the next launch");

    assert_eq!(first, second);
    assert_eq!(
        fs::read_to_string(&vanilla_path).await.unwrap(),
        VANILLA_CONFIG
    );

    let patched = fs::read_to_string(&first).await.unwrap();
    assert!(patched.contains(PATTERN_LAYOUT));
    assert!(patched.contains("nolookups"));
    assert!(!patched.contains("LegacyXMLLayout"));
}

#[tokio::test]
async fn a_patched_copy_carries_an_offline_launch() {
    let dir = tempfile::tempdir().unwrap();
    let service = MinecraftLoggingDownloadService::with_path(dir.path().to_path_buf());
    let vanilla_path = dir.path().join("client-1.12.xml");
    write(&vanilla_path, VANILLA_CONFIG).await;

    let online = service
        .download_logging_config(&logging_client())
        .await
        .unwrap();
    fs::remove_file(&vanilla_path).await.unwrap();

    let offline = service
        .download_logging_config(&logging_client())
        .await
        .expect("the patched copy must carry a launch while Mojang is unreachable");

    assert_eq!(online, offline);
}

#[tokio::test]
async fn a_missing_config_still_needs_the_network() {
    let dir = tempfile::tempdir().unwrap();
    let service = MinecraftLoggingDownloadService::with_path(dir.path().to_path_buf());

    let result = service.download_logging_config(&logging_client()).await;

    assert!(result.is_err(), "cold cache offline cannot succeed");
}
