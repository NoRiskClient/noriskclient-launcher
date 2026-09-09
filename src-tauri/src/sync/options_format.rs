use crate::sync::model::MergeFormat;

pub fn separator_for(format: MergeFormat) -> char {
    match format {
        MergeFormat::MinecraftOptions => ':',
        MergeFormat::PlainKeyValue => '=',
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Line {
    Pair { key: String, value: String },
    Raw(String),
}

#[derive(Clone, Debug)]
pub struct OptionsDocument {
    separator: char,
    lines: Vec<Line>,
    trailing_newline: bool,
}

impl OptionsDocument {
    pub fn empty(separator: char) -> Self {
        Self {
            separator,
            lines: Vec::new(),
            trailing_newline: true,
        }
    }

    pub fn parse(text: &str, separator: char) -> Self {
        let trailing_newline = text.is_empty() || text.ends_with('\n');
        let body = text.strip_suffix('\n').unwrap_or(text);
        let body = body.strip_suffix('\r').unwrap_or(body);

        let mut lines = Vec::new();
        if !body.is_empty() {
            for raw in body.split('\n') {
                let raw = raw.strip_suffix('\r').unwrap_or(raw);
                match split_pair(raw, separator) {
                    Some((key, value)) => lines.push(Line::Pair {
                        key: key.to_string(),
                        value: value.to_string(),
                    }),
                    None => lines.push(Line::Raw(raw.to_string())),
                }
            }
        }

        Self {
            separator,
            lines,
            trailing_newline,
        }
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for (index, line) in self.lines.iter().enumerate() {
            if index > 0 {
                out.push('\n');
            }
            match line {
                Line::Pair { key, value } => {
                    out.push_str(key);
                    out.push(self.separator);
                    out.push_str(value);
                }
                Line::Raw(raw) => out.push_str(raw),
            }
        }
        if self.trailing_newline && !out.is_empty() {
            out.push('\n');
        }
        out
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.lines.iter().find_map(|line| match line {
            Line::Pair { key: k, value } if k == key => Some(value.as_str()),
            _ => None,
        })
    }

    pub fn set(&mut self, key: &str, value: &str) {
        for line in self.lines.iter_mut() {
            if let Line::Pair { key: k, value: v } = line {
                if k == key {
                    if v != value {
                        *v = value.to_string();
                    }
                    return;
                }
            }
        }

        self.lines.push(Line::Pair {
            key: key.to_string(),
            value: value.to_string(),
        });
    }

    pub fn pairs(&self) -> Vec<(String, String)> {
        self.lines
            .iter()
            .filter_map(|line| match line {
                Line::Pair { key, value } => Some((key.clone(), value.clone())),
                _ => None,
            })
            .collect()
    }

    pub fn apply(&mut self, other: &OptionsDocument, skip_keys: &[String]) -> bool {
        let mut changed = false;
        for (key, value) in other.pairs() {
            if skip_keys.iter().any(|k| k == &key) {
                continue;
            }
            if self.get(&key) != Some(value.as_str()) {
                self.set(&key, &value);
                changed = true;
            }
        }
        changed
    }
}

fn split_pair(line: &str, separator: char) -> Option<(&str, &str)> {
    if line.trim().is_empty() {
        return None;
    }
    if line.starts_with('#') {
        return None;
    }
    let index = line.find(separator)?;
    let key = &line[..index];
    if key.is_empty() || key.trim() != key {
        return None;
    }
    Some((key, &line[index + separator.len_utf8()..]))
}
