"""Spell known names right in a transcript.

Whisper writes a name it does not know the way it sounds: "Meera" came out "Mira" five times in
five, "Daniel" as "Danyel" and "Priya" as "Pria" in the simulated meetings. A hint prompt helps
some models and hurts others, so after transcription every capitalised word that sounds like a
name from the user's own list (same first letter, same consonants, about the same length) is
replaced by that name. Only names from the list are ever written, never invented ones.
"""

import re
from difflib import SequenceMatcher

VOWELS = set("aeiouy")


def skeleton(word):
    """The consonants after the first letter, doubled letters collapsed: Meera, Mira, Mera -> mr."""
    w = word.lower()
    out = w[0]
    for ch in w[1:]:
        if ch not in VOWELS and ch != out[-1]:
            out += ch
    return out


def corrector(names):
    """A function that fixes the spelling of `names` in a text, or None when there are none."""
    targets = {}
    for name in names:
        for part in str(name).split():
            if len(part) >= 3 and part[0].isalpha():
                targets.setdefault(skeleton(part), set()).add(part)
    # a skeleton two different names share is ambiguous: leave words that match it alone
    targets = {k: next(iter(v)) for k, v in targets.items() if len(v) == 1}
    if not targets:
        return None
    known = {v.lower() for v in targets.values()}

    def fix(match):
        word = match.group(0)
        if word.lower() in known:
            return word
        name = targets.get(skeleton(word))
        # about the same length and spelling too: "Mary" and "Mirror" share Meera's m-r but
        # not its letters (similarity 0.44 and 0.36; "Mira" is 0.67, "Danyel" 0.83)
        if (name and name[0].lower() == word[0].lower() and abs(len(name) - len(word)) <= 2
                and SequenceMatcher(None, name.lower(), word.lower()).ratio() >= 0.6):
            return name
        return word

    return lambda text: re.sub(r"\b[A-Z][a-z]{2,}\b", fix, text)


# shortcut: Latin-script names only (the regex wants A-Z); names in Devanagari, Kannada, Tamil
# and other scripts are left as Whisper wrote them. Upgrade with a per-script skeleton.
