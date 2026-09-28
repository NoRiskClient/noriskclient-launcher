use crate::capture::window;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Aim {
    Process(u32),
    Screen(String),
}

#[derive(Clone)]
pub(super) enum Target {
    Window(window::GameWindow),
    Screen(crate::capture::screen::Screen),
}

impl Target {
    pub(super) fn aim(&self) -> Aim {
        match self {
            Self::Window(window) => Aim::Process(window.pid),
            Self::Screen(screen) => Aim::Screen(screen.device.clone()),
        }
    }

    pub(super) fn pid(&self) -> u32 {
        match self {
            Self::Window(window) => window.pid,
            Self::Screen(_) => 0,
        }
    }

    pub(super) fn size(&self) -> Option<(u32, u32)> {
        match self {
            Self::Window(window) => window::client_size(window.hwnd),
            Self::Screen(screen) => {
                crate::capture::screen::find(&screen.device).map(|found| (found.width, found.height))
            }
        }
    }

    pub(super) fn label(&self) -> String {
        match self {
            Self::Window(window) => format!("'{}' (pid {})", window.title, window.pid),
            Self::Screen(screen) => {
                format!("screen {} ({}x{})", screen.device, screen.width, screen.height)
            }
        }
    }
}
