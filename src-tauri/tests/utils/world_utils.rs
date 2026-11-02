use noriskclient_launcher_v3_lib::error::AppError;
use noriskclient_launcher_v3_lib::utils::world_utils::{
    check_world_session_lock, session_lock_is_held,
};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};
use tempfile::TempDir;

const HOLDER_PATH_ENV: &str = "NRC_TEST_SESSION_LOCK_PATH";
const HOLDER_READY: &str = "session-lock-held";

fn world_with_lock_file() -> TempDir {
    let world = tempfile::tempdir().unwrap();
    std::fs::write(world.path().join("session.lock"), "lock").unwrap();
    world
}

#[cfg(unix)]
fn hold_lock(path: &Path) -> std::fs::File {
    use std::os::fd::AsRawFd;

    let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    let mut lock: libc::flock = unsafe { std::mem::zeroed() };
    lock.l_type = libc::F_WRLCK as _;
    lock.l_whence = libc::SEEK_SET as _;
    let result = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETLK, &mut lock) };
    assert_ne!(result, -1, "{}", std::io::Error::last_os_error());
    file
}

#[cfg(not(unix))]
fn hold_lock(path: &Path) -> tokio::fs::File {
    use fs4::tokio::AsyncFileExt;

    let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    let file = tokio::fs::File::from_std(file);
    file.try_lock_exclusive().unwrap();
    file
}

#[tokio::test]
#[ignore = "runs as the other process in the session lock tests"]
async fn session_lock_holder() {
    let path = std::env::var(HOLDER_PATH_ENV).unwrap();
    let _file = hold_lock(Path::new(&path));
    println!("{HOLDER_READY}");
    std::io::stdout().flush().unwrap();
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).unwrap();
}

struct OtherProcessLock {
    child: Child,
    _stdout: BufReader<ChildStdout>,
}

impl OtherProcessLock {
    fn on(world: &Path) -> Self {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "world_utils::session_lock_holder",
                "--ignored",
                "--nocapture",
            ])
            .env(HOLDER_PATH_ENV, world.join("session.lock"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();

        let mut stdout = BufReader::new(child.stdout.take().unwrap());
        let held = stdout
            .by_ref()
            .lines()
            .map_while(Result::ok)
            .any(|line| line.contains(HOLDER_READY));
        assert!(held, "the other process never took the lock");
        Self {
            child,
            _stdout: stdout,
        }
    }

    fn release(mut self) {
        self.child.stdin.take();
        self.child.wait().unwrap();
    }
}

impl Drop for OtherProcessLock {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tokio::test]
async fn a_world_without_a_lock_file_is_not_locked() {
    let world = tempfile::tempdir().unwrap();

    assert!(!session_lock_is_held(world.path()).await.unwrap());
}

#[tokio::test]
async fn checking_a_world_does_not_create_a_lock_file() {
    let world = tempfile::tempdir().unwrap();

    check_world_session_lock(world.path()).await.unwrap();

    assert!(!world.path().join("session.lock").exists());
}

#[tokio::test]
async fn a_lock_file_left_behind_by_a_closed_game_is_not_locked() {
    let world = world_with_lock_file();

    assert!(!session_lock_is_held(world.path()).await.unwrap());
    check_world_session_lock(world.path()).await.unwrap();
}

#[tokio::test]
async fn a_lock_held_by_another_process_is_seen_until_it_is_released() {
    let world = world_with_lock_file();

    let lock = OtherProcessLock::on(world.path());
    assert!(session_lock_is_held(world.path()).await.unwrap());

    lock.release();
    assert!(!session_lock_is_held(world.path()).await.unwrap());
}

#[tokio::test]
async fn a_held_lock_reports_the_world_as_locked() {
    let world = world_with_lock_file();
    let _lock = OtherProcessLock::on(world.path());

    let error = check_world_session_lock(world.path()).await.unwrap_err();

    assert!(matches!(error, AppError::WorldLocked { .. }), "{error:?}");
}

#[cfg(unix)]
#[tokio::test]
async fn a_read_only_lock_file_can_still_be_checked() {
    use std::os::unix::fs::PermissionsExt;

    let world = world_with_lock_file();
    let lock_file = world.path().join("session.lock");
    std::fs::set_permissions(&lock_file, std::fs::Permissions::from_mode(0o444)).unwrap();

    assert!(!session_lock_is_held(world.path()).await.unwrap());
}

#[cfg(unix)]
#[tokio::test]
async fn a_lock_file_that_is_a_pipe_does_not_hang_the_check() {
    let world = tempfile::tempdir().unwrap();
    let lock_file = world.path().join("session.lock");
    let c_path = std::ffi::CString::new(lock_file.to_str().unwrap()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o644) }, 0);

    let check = session_lock_is_held(world.path());
    let finished = tokio::time::timeout(std::time::Duration::from_secs(5), check).await;

    assert!(finished.is_ok());
}
