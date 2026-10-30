from django.urls import include, path, re_path

from meetings.views import spa

urlpatterns = [
    path("api/", include("meetings.urls")),
    re_path(r"^(?!api/|static/).*$", spa),
]
