use noriskclient_launcher_v3_lib::minecraft::api::launcher_news_api::LauncherNewsPage;
use serde_json::{json, Value};

fn item(id: &str, title: Value) -> Value {
    json!({
        "id": id,
        "thumbnailUrl": "https://api.norisk.gg/a.webp",
        "url": null,
        "title": title,
        "publishedAt": 1
    })
}

fn page(items: Vec<Value>) -> LauncherNewsPage {
    serde_json::from_value(json!({ "items": items, "page": 1, "totalPages": 1, "total": items.len() })).unwrap()
}

#[test]
fn a_missing_translation_keeps_the_item() {
    let page = page(vec![item("a", json!({ "en": "News" }))]);
    assert_eq!(page.items[0].title.en, "News");
    assert_eq!(page.items[0].title.de, "");
}

#[test]
fn a_broken_item_is_skipped_and_the_rest_stays() {
    let page = page(vec![
        item("a", json!({ "en": "News", "de": null })),
        item("b", json!({ "en": "News", "de": "Neuigkeiten" })),
    ]);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, "b");
    assert_eq!(page.items[0].title.de, "Neuigkeiten");
}
