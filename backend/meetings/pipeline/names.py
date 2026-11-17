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


# ---- who is which speaker, from how people talk to each other (used for the summary only)
_INTRO = re.compile(r"\b(?:I'm|I am|this is|my name is)\s+([A-Z][a-z]{2,})\b")
_ADDRESS = re.compile(r"(?:^|[.?!]\s+)([A-Z][a-z]{2,}),")  # "Arjun, can you ..."
_REPLY = re.compile(r"^(?:yes|yeah|sure|thanks|thank you|okay|ok|good point|right|hi|hey)[,!]?\s+([A-Z][a-z]{2,})\b", re.IGNORECASE)
# capitalised words that start a sentence and a comma but are not names
_NOT_NAMES = {"Yes", "Yeah", "Sure", "Okay", "Thanks", "Well", "Now", "Then", "Great", "Good", "Right", "Also",
              "So", "And", "But", "Hello", "Hi", "Hey", "Today", "Tomorrow", "Next", "First", "Second", "Finally"}


def infer_speakers(segments, known=()):
    """{speaker number: name} worked out from the conversation: a speaker who says "I'm
    Priya" is Priya; whoever answers "Arjun, can you ..." is Arjun; whoever was just
    speaking when the next one says "Thanks Priya" is Priya. Votes decide, and each name and
    each speaker is used once. `known` names count with any number of votes; another word
    needs two votes to count as a name. Nothing here is saved: speaker names stay the user's
    to set (R1.18); this only lets the summary know who said "I'll do it"."""
    from collections import Counter

    votes = Counter()
    segs = [s for s in segments if s.speaker is not None]
    for i, s in enumerate(segs):
        for name in _INTRO.findall(s.text):
            votes[(s.speaker, name)] += 2
        nxt = next((t for t in segs[i + 1:i + 3] if t.speaker != s.speaker), None)
        if nxt:
            for name in _ADDRESS.findall(s.text):
                votes[(nxt.speaker, name)] += 1
        prev = next((t for t in reversed(segs[max(0, i - 2):i]) if t.speaker != s.speaker), None)
        m = _REPLY.match(s.text.strip())
        if prev and m:
            votes[(prev.speaker, m.group(1))] += 1
    known = set(known)
    total = Counter()
    for (spk, name), n in votes.items():
        total[name] += n
    out, used = {}, set()
    for (spk, name), n in votes.most_common():
        if name in _NOT_NAMES or spk in out or name in used:
            continue
        if name not in known and total[name] < 2:
            continue
        out[spk], _ = name, used.add(name)
    return out
