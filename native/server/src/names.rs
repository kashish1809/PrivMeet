//! Names: the hint for Whisper, the corrector for near-miss spellings, and who each speaker is
//! from the conversation.

use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;
use rusqlite::Connection;
use serde_json::Value;

use crate::meetings::Segment;
use crate::settings::Settings;

/// The user's display name, the speaker names saved on the last 30 meetings and the Settings
/// vocabulary, first spelling wins, "Speaker N" left out.
pub fn known_names(db: &Connection, saved: &Settings) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut add = |w: &str| {
        let w = w.trim();
        if !w.is_empty() && !w.to_lowercase().starts_with("speaker") && !names.iter().any(|n| n.to_lowercase() == w.to_lowercase()) {
            names.push(w.to_string());
        }
    };
    add(saved.get("display_name").and_then(Value::as_str).unwrap_or(""));
    let lists: Vec<String> = db
        .prepare("SELECT speaker_names FROM meetings WHERE speaker_names != '{}' ORDER BY created DESC LIMIT 30")
        .and_then(|mut st| st.query_map([], |r| r.get(0))?.collect())
        .unwrap_or_default();
    for l in lists {
        if let Ok(Value::Object(o)) = serde_json::from_str::<Value>(&l) {
            for v in o.values() {
                add(v.as_str().unwrap_or(""));
            }
        }
    }
    for w in saved.get("vocabulary").and_then(Value::as_str).unwrap_or("").split([',', ';', '\n']) {
        add(w);
    }
    names
}

/// "Names and terms: Priya, Arjun." for Whisper's prompt (it copies spellings it sees there),
/// capped at 400 characters; "" when there are none.
pub fn asr_prompt(names: &[String]) -> String {
    let mut text = names.join(", ");
    if text.chars().count() > 400 {
        let cut: String = text.chars().take(400).collect();
        text = cut.rsplit_once(',').map(|(a, _)| a.to_string()).unwrap_or(cut);
    }
    if text.is_empty() { String::new() } else { format!("Names and terms: {text}.") }
}

/// The consonants after the first letter, doubles collapsed: Meera, Mira, Mera -> "mr".
pub fn skeleton(word: &str) -> String {
    let w = word.to_lowercase();
    let mut chars = w.chars();
    let Some(first) = chars.next() else { return String::new() };
    let mut out = first.to_string();
    for c in chars {
        if !"aeiouy".contains(c) && out.chars().last() != Some(c) {
            out.push(c);
        }
    }
    out
}

/// Python's difflib.SequenceMatcher(None, a, b).ratio(): 2 * matched / total, matched being the
/// longest common block and, recursively, the blocks to its left and right.
pub fn ratio(a: &str, b: &str) -> f64 {
    fn matched(a: &[char], b: &[char]) -> usize {
        let (mut best, mut ai, mut bj) = (0, 0, 0);
        for i in 0..a.len() {
            for j in 0..b.len() {
                let mut k = 0;
                while i + k < a.len() && j + k < b.len() && a[i + k] == b[j + k] {
                    k += 1;
                }
                if k > best {
                    (best, ai, bj) = (k, i, j);
                }
            }
        }
        if best == 0 {
            return 0;
        }
        best + matched(&a[..ai], &b[..bj]) + matched(&a[ai + best..], &b[bj + best..])
    }
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    2.0 * matched(&a, &b) as f64 / (a.len() + b.len()) as f64
}

/// Replaces a capitalised word that sounds like a known name with that name: same first
/// letter, same consonant skeleton, within two letters in length and at least 0.6 similar
/// ("Mira" -> "Meera", "Danyel" -> "Daniel"; "Mary" and "Mirror" stay). A skeleton two names
/// share is left alone. Only names from the list are ever written.
pub struct Corrector {
    targets: HashMap<String, String>,
}

impl Corrector {
    pub fn new(names: &[String]) -> Option<Self> {
        let mut by: HashMap<String, Vec<String>> = HashMap::new();
        for name in names {
            for part in name.split_whitespace() {
                if part.chars().count() >= 3 && part.chars().next().is_some_and(char::is_alphabetic) {
                    let list = by.entry(skeleton(part)).or_default();
                    if !list.contains(&part.to_string()) {
                        list.push(part.to_string());
                    }
                }
            }
        }
        let targets: HashMap<String, String> = by.into_iter().filter(|(_, v)| v.len() == 1).map(|(k, mut v)| (k, v.remove(0))).collect();
        (!targets.is_empty()).then_some(Corrector { targets })
    }

    pub fn fix(&self, text: &str) -> String {
        static WORD: OnceLock<Regex> = OnceLock::new();
        let word = WORD.get_or_init(|| Regex::new(r"\b[A-Z][a-z]{2,}\b").unwrap());
        word.replace_all(text, |c: &regex::Captures| {
            let w = &c[0];
            if self.targets.values().any(|n| n.eq_ignore_ascii_case(w)) {
                return w.to_string();
            }
            match self.targets.get(&skeleton(w)) {
                Some(name)
                    if name.chars().next().map(|c| c.to_ascii_lowercase()) == w.chars().next().map(|c| c.to_ascii_lowercase())
                        && (name.chars().count() as i64 - w.chars().count() as i64).abs() <= 2
                        && ratio(&name.to_lowercase(), &w.to_lowercase()) >= 0.6 =>
                {
                    name.clone()
                }
                _ => w.to_string(),
            }
        })
        .to_string()
    }
}
// shortcut: Latin-script names only (the regex wants A-Z); upgrade with a per-script skeleton.

const NOT_NAMES: &[&str] = &[
    "Yes", "Yeah", "Sure", "Okay", "Thanks", "Well", "Now", "Then", "Great", "Good", "Right", "Also", "So", "And", "But",
    "Hello", "Hi", "Hey", "Today", "Tomorrow", "Next", "First", "Second", "Finally",
];

/// {speaker: name} worked out from how people talk: "I'm Priya" names its speaker; whoever
/// answers "Arjun, can you ..." is Arjun; whoever was just speaking when the next says
/// "Thanks Priya" is Priya. Votes decide, each name and speaker used once; a word not in
/// `known` needs two votes. Used for the summary only, never saved.
pub fn infer_speakers(segments: &[Segment], known: &[String]) -> HashMap<i64, String> {
    static INTRO: OnceLock<Regex> = OnceLock::new();
    static ADDRESS: OnceLock<Regex> = OnceLock::new();
    static REPLY: OnceLock<Regex> = OnceLock::new();
    let intro = INTRO.get_or_init(|| Regex::new(r"\b(?:I'm|I am|this is|my name is)\s+([A-Z][a-z]{2,})\b").unwrap());
    let address = ADDRESS.get_or_init(|| Regex::new(r"(?:^|[.?!]\s+)([A-Z][a-z]{2,}),").unwrap());
    let reply = REPLY.get_or_init(|| Regex::new(r"(?i)^(?:yes|yeah|sure|thanks|thank you|okay|ok|good point|right|hi|hey)[,!]?\s+([A-Z][a-z]{2,})\b").unwrap());
    let segs: Vec<&Segment> = segments.iter().filter(|s| s.speaker.is_some()).collect();
    let mut votes: HashMap<(i64, String), i64> = HashMap::new();
    for (i, s) in segs.iter().enumerate() {
        let me = s.speaker.unwrap();
        for c in intro.captures_iter(&s.text) {
            *votes.entry((me, c[1].to_string())).or_insert(0) += 2;
        }
        if let Some(next) = segs[i + 1..segs.len().min(i + 3)].iter().find(|t| t.speaker != s.speaker) {
            for c in address.captures_iter(&s.text) {
                *votes.entry((next.speaker.unwrap(), c[1].to_string())).or_insert(0) += 1;
            }
        }
        let prev = segs[i.saturating_sub(2)..i].iter().rev().find(|t| t.speaker != s.speaker);
        if let (Some(prev), Some(c)) = (prev, reply.captures(s.text.trim())) {
            // the case-insensitive lead may match a lower-case word: names stay capitalised
            if c[1].chars().next().is_some_and(char::is_uppercase) {
                *votes.entry((prev.speaker.unwrap(), c[1].to_string())).or_insert(0) += 1;
            }
        }
    }
    let mut total: HashMap<String, i64> = HashMap::new();
    for ((_, name), n) in &votes {
        *total.entry(name.clone()).or_insert(0) += n;
    }
    let mut ranked: Vec<((i64, String), i64)> = votes.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let (mut out, mut used): (HashMap<i64, String>, Vec<String>) = (HashMap::new(), Vec::new());
    for ((spk, name), _) in ranked {
        if NOT_NAMES.contains(&name.as_str()) || out.contains_key(&spk) || used.contains(&name) {
            continue;
        }
        if !known.contains(&name) && total[&name] < 2 {
            continue;
        }
        used.push(name.clone());
        out.insert(spk, name);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ratio_matches_difflib() {
        // difflib.SequenceMatcher(None, a, b).ratio() for each pair
        assert!((ratio("meera", "mira") - 0.6667).abs() < 1e-3);
        assert!((ratio("meera", "mary") - 0.4444).abs() < 1e-3);
        assert!((ratio("meera", "mirror") - 0.3636).abs() < 1e-3);
        assert!((ratio("daniel", "danyel") - 0.8333).abs() < 1e-3);
    }

    #[test]
    fn corrects_only_near_misses() {
        let fix = Corrector::new(&["Priya".into(), "Arjun".into(), "Meera".into(), "Daniel".into(), "Rohan".into()]).unwrap();
        let t = "Yes Mira, same one. Thanks Pria. Danyel and Meeera, Mera too. Mary and Margaret stay. Dan stays. Design stays. Mirror stays. Daniel stays. Rowan, Rohan and Robin. Arjoon. Monday stays. Media stays.";
        assert_eq!(fix.fix(t), "Yes Meera, same one. Thanks Priya. Daniel and Meera, Meera too. Mary and Margaret stay. Dan stays. Design stays. Mirror stays. Daniel stays. Rowan, Rohan and Robin. Arjun. Monday stays. Media stays.");
        assert!(Corrector::new(&[]).is_none());
        assert_eq!(asr_prompt(&["Priya".into(), "Arjun".into()]), "Names and terms: Priya, Arjun.");
    }

    #[test]
    fn infers_speakers_from_talk() {
        let lines = [
            (0, "Good morning everyone. I'm Priya, and I'll keep notes today."),
            (0, "Arjun, can you start with the payment screen?"),
            (1, "Sure, Priya. The new payment screen is done."),
            (2, "Arjun, is that the same crash?"),
            (1, "Yes Meera, same one."),
            (0, "Great. Daniel, how is the onboarding?"),
            (3, "Thanks Priya. The designs are finished."),
        ];
        let segs: Vec<Segment> = lines.iter().map(|(k, t)| Segment { id: 0, start: 0.0, end: 1.0, speaker: Some(*k), text: t.to_string() }).collect();
        let got = infer_speakers(&segs, &[]);
        assert_eq!(got.get(&0).map(String::as_str), Some("Priya"));
        assert_eq!(got.get(&1).map(String::as_str), Some("Arjun"));
        // one vote only: not enough for a name nobody listed, enough for a known one
        assert_eq!(got.get(&3), None);
        assert_eq!(infer_speakers(&segs, &["Daniel".into()]).get(&3).map(String::as_str), Some("Daniel"));
        let none = vec![Segment { id: 0, start: 0.0, end: 1.0, speaker: Some(0), text: "Okay, let's start.".into() }];
        assert!(infer_speakers(&none, &[]).is_empty());
    }
}
