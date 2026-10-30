import operator
import re
from functools import reduce

from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
from django.db import connection
from django.db.models import Q

# Must match the GIN index expression in migration 0002 so Postgres can use it.
VECTOR = SearchVector("text", config="english")


def words(text):
    return [w for w in re.findall(r"\w+", text.lower()) if len(w) > 2][:12]


def search_segments(qs, text):
    """Segments matching any word of `text`, best first."""
    ws = words(text)
    if not ws:
        return qs.none()
    if connection.vendor == "postgresql":
        query = reduce(operator.or_, (SearchQuery(w, config="english") for w in ws))
        return qs.annotate(search=VECTOR, rank=SearchRank(VECTOR, query)).filter(search=query).order_by("-rank")
    return qs.filter(reduce(operator.or_, (Q(text__icontains=w) for w in ws)))


def excerpts(meeting, question, max_chars):
    """Whole transcript when it fits the model context, else the best-matching segments with neighbours."""
    segs = list(meeting.segments.all())
    full = meeting.transcript(timestamps=True, segments=segs)
    if len(full) <= max_chars:
        return full
    # shortcut: keyword retrieval only, upgrade to pgvector + nomic-embed-text if recall is poor.
    hits = search_segments(meeting.segments.all(), question).values_list("id", flat=True)[:8]
    pos = {s.id: i for i, s in enumerate(segs)}
    keep = sorted({j for h in hits for j in range(pos[h] - 2, pos[h] + 3) if 0 <= j < len(segs)})
    return meeting.transcript(timestamps=True, segments=[segs[j] for j in keep])[:max_chars]
