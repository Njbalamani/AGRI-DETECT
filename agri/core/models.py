from django.db import models


class InspectionRecord(models.Model):
    record_id = models.CharField(max_length=64, unique=True)
    crop = models.CharField(max_length=200, blank=True)
    crop_id = models.CharField(max_length=100, blank=True)
    palm_id = models.CharField(max_length=100, blank=True)
    zone = models.CharField(max_length=100, blank=True)
    risk = models.CharField(max_length=20, blank=True)
    confidence = models.PositiveSmallIntegerField(null=True, blank=True)
    method = models.CharField(max_length=20, blank=True)
    findings = models.TextField(blank=True)
    guidance = models.TextField(blank=True)
    disease = models.JSONField(null=True, blank=True)
    date_client = models.CharField(max_length=100, blank=True)
    follow_up_at = models.BigIntegerField(null=True, blank=True)
    follow_up_done = models.BooleanField(default=False)
    payload = models.JSONField(default=dict, blank=True)
    source_updated_at = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.record_id

    def to_sync_dict(self):
        data = dict(self.payload)
        data.update({
            "id": self.record_id,
            "crop": self.crop,
            "cropId": self.crop_id,
            "palmId": self.palm_id,
            "zone": self.zone,
            "risk": self.risk,
            "confidence": self.confidence,
            "method": self.method,
            "findings": self.findings,
            "guidance": self.guidance,
            "disease": self.disease,
            "date": self.date_client,
            "followUpAt": self.follow_up_at,
            "followUpDone": self.follow_up_done,
            "updatedAt": self.source_updated_at,
        })
        return data
