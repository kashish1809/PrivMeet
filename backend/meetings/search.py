import operator
import re
from functools import reduce

from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
from django.db import connection
from django.db.models import Q

# Must match the GIN index expression in migration 0002 so Postgres can use it.
VECTOR = SearchVector("text", config="english")

# Question words carry no topic. Without this list "what did they say about the budget"
# ranks every line with "they" or "say" as high as the line about the budget.
STOPWORDS = set(
    "the and for are but not you all any can had her was one our out has have him his how its "
    "who did what when where why which will with this that they them then there these those "
    "from about into over said say says tell told does done been were would could should "
    "your yours mine meeting talk talked discuss discussed mention mentioned anyone someone "
    "anything something please give list".split()
)
HITS = 8  # best segments kept for a long meeting
# Lines kept around a hit. Mostly after it: a topic is raised first and decided later (in the
# 55 min test the cloud bill came up 17 lines before "move the test servers"), and the
# answer to a question usually follows the words that match it.
BEFORE, AFTER = 2, 20


def words(text, question=False):
    """Search words of `text`. `question=True` also drops question filler (for Q&A only:
    the meeting list keeps searching for whatever the user typed)."""
    seen = []
    for w in re.findall(r"\w+", text.lower()):
        if len(w) > 2 and not (question and w in STOPWORDS) and w not in seen:
            seen.append(w)
    return seen[:12]


def search_segments(qs, text, question=False):
    """Segments matching any word of `text`, best first."""
    ws = words(text, question)
    if not ws:
        return qs.none()
    if connection.vendor == "postgresql":
        query = reduce(operator.or_, (SearchQuery(w, config="english") for w in ws))
        return qs.annotate(search=VECTOR, rank=SearchRank(VECTOR, query)).filter(search=query).order_by("-rank")
    return qs.filter(reduce(operator.or_, (Q(text__icontains=w) for w in ws)))


def best_hits(meeting, question, segs):
    """Ids of the segments that best match the question.

    Postgres ranks with ts_rank. SQLite has no ranking, so count the distinct question words
    in each matching line there: a line with "budget" and "marketing" beats one with "budget".
    """
    qs = search_segments(meeting.segments.all(), question, question=True)
    if connection.vendor == "postgresql":
        return list(qs.values_list("id", flat=True)[:HITS])
    ws = words(question, question=True)
    scored = [(sum(w in s.text.lower() for w in ws), -s.start, s.id) for s in segs if any(w in s.text.lower() for w in ws)]
    return [sid for *_, sid in sorted(scored, reverse=True)[:HITS]]


def excerpts(meeting, question, max_chars):
    """Whole transcript when it fits the model context, else the best-matching segments with neighbours."""
    segs = list(meeting.segments.all())
    full = meeting.transcript(timestamps=True, segments=segs)
    if len(full) <= max_chars:
        return full
    # shortcut: keyword retrieval only, upgrade to pgvector + nomic-embed-text if recall is poor.
    hits = best_hits(meeting, question, segs)
    if not hits:
        # Nothing matched ("summarize the meeting", or words the transcript spells differently).
        # The meeting summary plus its opening lines beats an empty context, which only ever
        # gets "the meeting does not say".
        head = f"Meeting summary: {meeting.summary}\n\n" if meeting.summary else ""
        return (head + full)[:max_chars]
    pos = {s.id: i for i, s in enumerate(segs)}
    lines_of = {}
    keep, used = set(), 0
    # Best hit first, so when the budget runs out it is the weakest hits that lose their tail.
    for h in hits:
        for j in range(pos[h] - BEFORE, pos[h] + AFTER + 1):
            if 0 <= j < len(segs) and j not in keep:
                line = lines_of[j] = meeting.transcript(timestamps=True, segments=[segs[j]])
                if used + len(line) + 1 > max_chars:
                    break
                keep.add(j)
                used += len(line) + 1
    keep = sorted(keep)
    # Gaps between kept runs are marked so the model does not read two far-apart lines as one exchange.
    lines, last = [], None
    for j in keep:
        if last is not None and j != last + 1:
            lines.append("...")
        lines.append(lines_of[j])
        last = j
    return "\n".join(lines)[:max_chars]
