use crate::support::handler::SupportContext;
use crate::support::handlers::logs::{found, FileItemHandler, Located};
use crate::utils::security_utils::mask_sensitive_data;

const LAST_SERVER: &str = "lastServer:";

pub const HANDLER: FileItemHandler = FileItemHandler {
    redact: redact_options,
    ..FileItemHandler::plain("MC_SETTINGS", locate_options)
};

fn locate_options(ctx: &SupportContext) -> Located {
    found(&ctx.instance_path, "options.txt")
}

fn hide_last_server(line: &str) -> String {
    match line.strip_prefix(LAST_SERVER) {
        Some(address) if !address.trim().is_empty() => {
            let ending = &line[line.trim_end_matches(['\r', '\n']).len()..];
            format!("{}*****{}", LAST_SERVER, ending)
        }
        _ => line.to_string(),
    }
}

fn redact_options(text: &str) -> Result<String, String> {
    let hidden: String = text.split_inclusive('\n').map(hide_last_server).collect();
    Ok(mask_sensitive_data(&hidden))
}
