from django.contrib.postgres.indexes import GinIndex
from django.db import migrations

from meetings.search import VECTOR

# Not in Segment.Meta.indexes: the GIN index is Postgres-only and SQLite dev/test DBs must still migrate.
INDEX = GinIndex(VECTOR, name="segment_fts")


def add_index(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.add_index(apps.get_model("meetings", "Segment"), INDEX)


def drop_index(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.remove_index(apps.get_model("meetings", "Segment"), INDEX)


class Migration(migrations.Migration):
    dependencies = [("meetings", "0001_initial")]

    operations = [migrations.RunPython(add_index, drop_index)]
