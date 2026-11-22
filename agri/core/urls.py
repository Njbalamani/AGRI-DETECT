from django.urls import path, re_path

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("index.html", views.home, name="index"),
    path("detection.html", views.detection, name="detection"),
    path("history.html", views.history, name="history"),
    path("about.html", views.about, name="about"),
    path("settings.html", views.settings_page, name="settings"),
    path("api/history/sync", views.history_sync, name="history-sync"),
    re_path(r"^(?P<path>.+)$", views.asset, name="asset"),
]
