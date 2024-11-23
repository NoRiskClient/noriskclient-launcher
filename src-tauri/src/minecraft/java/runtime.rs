use std::path::{Path, PathBuf};
use std::process::Stdio;
use anyhow::{Result, bail};
use tokio::{io::AsyncReadExt, sync::oneshot::Receiver, process::{Child, Command}};
use log::debug;
use uuid::Uuid;
use crate::custom_servers::manager::CustomServerManager;
use crate::custom_servers::models::{CustomServer, CustomServerTokenResponse};
use crate::custom_servers::providers::forwarding_manager::ForwardingManagerProvider;

pub struct JavaRuntime(PathBuf);

impl JavaRuntime {

    pub fn new(path: PathBuf) -> JavaRuntime {
        JavaRuntime(path)
    }

    pub fn execute(&self, arguments: Vec<String>, game_dir: &Path) -> Result<Child> {
        let mut command = Command::new(&self.0);
        command.current_dir(game_dir);
        command.args(arguments);

        command
            .stderr(Stdio::piped())
            .stdout(Stdio::piped());

        let child = command.spawn()?;
        Ok(child)
    }

    pub async fn run_server(&self, max_ram: u64, min_ram: u64, server_dir: &Path) -> Result<Child> {
        let mut command = Command::new(&self.0);
        command.current_dir(server_dir);
        command.arg("-Xmx".to_owned() + &max_ram.to_string() + "M");
        command.arg("-Xms".to_owned() + &min_ram.to_string() + "M");
        command.arg("-jar").arg("server.jar");
        command.arg("nogui".to_owned());

        command
            .stderr(Stdio::piped())
            .stdout(Stdio::piped());

        let child = command.spawn()?;
        Ok(child)
    }

    pub async fn handle_io<D: Send + Sync>(&self, running_task: &mut Child, on_stdout: fn(&D, &[u8], Uuid) -> Result<()>, on_stderr: fn(&D, &[u8], Uuid) -> Result<()>, terminator: Receiver<()>, data: &D, instance_id: Uuid) -> Result<()> {
        let mut stdout = running_task.stdout.take().unwrap();
        let mut stderr = running_task.stderr.take().unwrap();
    
        let mut stdout_buf = vec![0; 1024];
        let mut stderr_buf = vec![0; 1024];
    
        tokio::pin!(terminator);
    
        loop {
            tokio::select! {
                read_len = stdout.read(&mut stdout_buf) => {
                    let _ = (on_stdout)(&data, &stdout_buf[..read_len?], instance_id);
                },
                read_len = stderr.read(&mut stderr_buf) => {
                    let _ = (on_stderr)(&data, &stderr_buf[..read_len?], instance_id);
                },
                _ = &mut terminator => {
                    running_task.kill().await?;
                    break;
                },
                exit_status = running_task.wait() => {
                    let code = exit_status?.code().unwrap_or(7900); // 7900 = unwrap failed error code

                    debug!("Process exited with code: {}", code);
                    if code != 0 && code != -1073740791 { // -1073740791 = happens when the process is killed forcefully, we don't want to bail in this case
                        bail!("Process exited with non-zero code: {}", code);
                    }
                    break;
                },
            }
        }
        Ok(())
    }

    pub async fn handle_server_io<D: Send + Sync>(&self, running_task: &mut Child, server: &CustomServer, tokens: &CustomServerTokenResponse, on_stdout: fn(&D, &str, &[u8]) -> Result<()>, on_stderr: fn(&D, &str, &[u8]) -> Result<()>, java_runtime: &JavaRuntime, data: &D) -> Result<()> {
        let mut stdout = running_task.stdout.take().unwrap();
        let mut stderr = running_task.stderr.take().unwrap();
    
        let mut stdout_buf = vec![0; 1024];
        let mut stderr_buf = vec![0; 1024];

        let mut startet_forwarding = false;
    
        loop {
            tokio::select! {
                read_len = stdout.read(&mut stdout_buf) => {
                    let content = &stdout_buf[..read_len?];
                    if String::from_utf8_lossy(content).contains("Done") && !startet_forwarding {
                        let server_clone = server.clone();
                        let tokens_clone = tokens.clone();
                        let forwarder: Child = ForwardingManagerProvider::start_forwarding_manager(java_runtime, &server_clone.domain, &server_clone.subdomain, &tokens_clone.jwt, &tokens_clone.private_key).unwrap();
                        let latest_running_server = CustomServerManager::load_latest_running_server().await.unwrap();
                        CustomServerManager::store_latest_running_server(forwarder.id(), latest_running_server.process_id.clone(), latest_running_server.server_id).await.unwrap();
                        startet_forwarding = true;
                    }
                    let _ = (on_stdout)(&data, &server.id, content);
                },
                read_len = stderr.read(&mut stderr_buf) => {
                    let _ = (on_stderr)(&data, &server.id, &stderr_buf[..read_len?]);
                },
                exit_status = running_task.wait() => {
                    let code = exit_status?.code().unwrap_or(7900); // 7900 = unwrap failed error code

                    debug!("Process exited with code: {}", code);
                    if code != 0 && code != -1073740791 { // -1073740791 = happens when the process is killed forcefully, we don't want to bail in this case
                        bail!("Process exited with non-zero code: {}", code);
                    }
                    break;
                },
            }
        }
        Ok(())
    }
}