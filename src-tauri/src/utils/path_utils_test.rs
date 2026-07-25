use super::*;

#[test]
fn keeps_names_the_jvm_can_receive() {
    assert_eq!(to_launchable_ascii("Create+ 6.0"), "Create+ 6.0");
    assert_eq!(to_launchable_ascii("BattleArmory TACZ"), "BattleArmory TACZ");
}

#[test]
fn transliterates_other_scripts() {
    assert_eq!(
        to_launchable_ascii("\u{7ea2}\u{77f3}\u{751f}\u{7535}\u{4f18}\u{5316}26.2"),
        "Hong Shi Sheng Dian You Hua 26.2"
    );
    assert!(to_launchable_ascii("\u{041c}\u{043e}\u{0439}").starts_with("Moi"));
}

#[test]
fn derives_a_stable_name_when_nothing_is_left() {
    let empty = to_launchable_ascii("");
    assert!(empty.starts_with("profile-"), "got {empty}");
    assert_eq!(empty, to_launchable_ascii(""));
}
