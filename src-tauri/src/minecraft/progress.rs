use core::convert::AsRef;

use serde::Serialize;

#[derive(Debug)]
pub enum ProgressUpdateSteps {
    DownloadNoRiskClientMods,
    DownloadShader,
    DownloadResourcePack,
    DownloadDatapack,
    DownloadJRE,
    DownloadClientJar,
    DownloadLibraries,
    DownloadAssets,
    DownloadNoRiskAssets,
    VerifyNoRiskAssets,

    DownloadCustomServerJar,
    DownloadCustomServerInstallerJar,
}

#[must_use]
pub fn get_progress(idx: usize, curr: u64, max: u64) -> u64 {
    idx as u64 * 100 + (curr * 100 / max.max(1))
}

#[must_use]
pub const fn get_max(len: usize) -> u64 {
    len as u64 * 100
}

impl ProgressUpdateSteps {
    const fn len() -> usize {
        12
    }

    const fn step_idx(&self) -> usize {
        match self {
            Self::DownloadNoRiskClientMods => 0,
            Self::DownloadJRE | Self::DownloadCustomServerJar => 1,
            Self::DownloadClientJar
            | Self::DownloadCustomServerInstallerJar => 2,
            Self::DownloadLibraries => 3,
            Self::DownloadAssets => 4,
            Self::DownloadNoRiskAssets => 5,
            Self::VerifyNoRiskAssets => 6,
            Self::DownloadShader => 7,
            Self::DownloadResourcePack => 8,
            Self::DownloadDatapack => 9,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", content = "value")]
pub enum ProgressUpdate {
    #[serde(rename = "max")]
    SetMax(u64),
    #[serde(rename = "progress")]
    SetProgress(u64),
    #[serde(rename = "label")]
    SetLabel(String),
}

const PER_STEP: u64 = 1024;

impl ProgressUpdate {
    #[allow(clippy::needless_pass_by_value)] // TODO: check if we really need this
    #[must_use]
    pub const fn set_for_step(step: ProgressUpdateSteps, progress: u64, max: u64) -> Self {
        Self::SetProgress(step.step_idx() as u64 * PER_STEP + (progress * PER_STEP / max))
    }
    #[must_use]
    pub const fn set_to_max() -> Self {
        Self::SetProgress(ProgressUpdateSteps::len() as u64 * PER_STEP)
    }
    #[must_use]
    pub const fn set_max() -> Self {
        let max = ProgressUpdateSteps::len() as u64;

        Self::SetMax(max * PER_STEP)
    }
    pub fn set_label<S: AsRef<str>>(str: S) -> Self {
        return Self::SetLabel(str.as_ref().to_owned());
    }
}

pub trait ProgressReceiver {
    fn progress_update(&self, update: ProgressUpdate);
}
