from django.urls import path

from . import views

urlpatterns = [
    path("meetings/", views.meetings),
    path("meetings/<uuid:pk>/", views.meeting_detail),
    path("meetings/<uuid:pk>/audio", views.meeting_audio),
    path("meetings/<uuid:pk>/audio.<str:fmt>", views.meeting_audio_export),
    path("meetings/<uuid:pk>/ask", views.meeting_ask),
    path("meetings/<uuid:pk>/retry", views.meeting_retry),
    path("meetings/<uuid:pk>/export.<str:fmt>", views.meeting_export),
    path("questions/<int:pk>/", views.question_detail),
    path("system/", views.system),
    path("settings/", views.user_settings),
    path("settings/test", views.settings_test),
    path("tags/", views.tags),
    path("action-items/", views.action_items),
    path("templates/", views.templates),
    path("templates/<str:tid>/", views.template_detail),
    path("models/", views.models),
    path("models/pull", views.models_pull),
    path("models/<path:name>", views.models_delete),
]
