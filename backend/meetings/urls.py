from django.urls import path

from . import views

urlpatterns = [
    path("meetings/", views.meetings),
    path("meetings/<uuid:pk>/", views.meeting_detail),
    path("meetings/<uuid:pk>/audio", views.meeting_audio),
    path("meetings/<uuid:pk>/ask", views.meeting_ask),
    path("meetings/<uuid:pk>/retry", views.meeting_retry),
    path("meetings/<uuid:pk>/export.md", views.meeting_export),
    path("questions/<int:pk>/", views.question_detail),
    path("system/", views.system),
]
