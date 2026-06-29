const ICONFONT_BASE: &str =
    "https://cdn.norisk.gg/assets/norisk-prod/assets/nrc-cosmetics/assets/noriskclient/textures/iconfont/";
const CREATORCODE_BASE: &str =
    "https://cdn.norisk.gg/assets/norisk-prod/assets/nrc-cosmetics/assets/noriskclient/creatorcode/icons/";

pub const CREATOR_CODE_ICON_UUID: &str = "1e441d2b-c975-43b8-aeee-e46dd0dfd216";

fn icon_name_by_uuid(uuid: &str) -> Option<&'static str> {
    let name = match uuid {
        "82cfa3df-72d7-43d0-881f-6f5e3a5cfaa4" => "default",
        "f9c39f3a-5ee7-4f8d-a4f7-682e7c96d0df" => "beta",
        "6f377aad-d56c-4f48-941e-212472faec80" => "admin",
        "ac46e7e9-111d-4daa-9d72-23547379ccee" => "designer",
        "63f403ea-7bed-47ea-913b-04c52df0b68b" => "vip",
        "1e441d2b-c975-43b8-aeee-e46dd0dfd216" => "creator_code",
        "fec7a04c-9354-42a4-9b25-21b6b131b425" => "developer",
        "39c239c6-2ed0-45fb-98f2-6959ed1b4ce7" => "helper",
        "3d3eef4a-cace-463b-980f-19af523b1321" => "bug_hunter",
        "e848ede9-112d-4daa-9d76-23547379ccec" => "black_week",
        "760b2217-f70e-4827-bb7b-23d9c01c7882" => "black_week_v2",
        "5934b324-db85-4de9-a264-8c72b4ce9d4e" => "xmas",
        "0d93c97d-bc41-488b-87db-ea2d4870dbfd" => "christmas_2025",
        "9ccf16dd-c7da-40eb-8d73-538ef4d5a074" => "special_rank",
        "ecaf77d3-b0bb-47a7-b922-d72318fef104" => "bronze_donator",
        "66f167bc-6762-4750-b6ce-3a6bb837d5f0" => "silver_donator",
        "f9add58d-d466-4d6d-ace0-e20d71f68f0f" => "gold_donator",
        "d88ee37c-4cc1-4966-b7cb-c140cd8f417c" => "gifter",
        "4ba04722-9849-4b73-837f-5527f7261c09" => "valentines",
        "18d16634-a6dc-484c-85c8-81be5d46c765" => "halloween_2025",
        "53f3ba0a-acf7-40bd-aa49-ab9ad18a0dc2" => "partner",
        "bf6bf611-b62f-4e9d-8a4b-6aaa685a06a2" => "gamescom_2025",
        "675112de-a0ba-4fa2-8edc-06d809fae060" => "gamescom_2026",
        _ => return None,
    };
    Some(name)
}

pub fn icon_url_for_uuid(uuid: Option<&str>) -> Option<String> {
    let uuid = uuid?;
    let name = icon_name_by_uuid(uuid)?;
    Some(format!("{}{}_icons.png", ICONFONT_BASE, name))
}

pub fn creator_code_icon_url(code: &str) -> String {
    format!("{}{}.png", CREATORCODE_BASE, code.to_lowercase())
}
