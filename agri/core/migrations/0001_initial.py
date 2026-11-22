from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='InspectionRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('record_id', models.CharField(max_length=64, unique=True)),
                ('crop', models.CharField(blank=True, max_length=200)),
                ('crop_id', models.CharField(blank=True, max_length=100)),
                ('palm_id', models.CharField(blank=True, max_length=100)),
                ('zone', models.CharField(blank=True, max_length=100)),
                ('risk', models.CharField(blank=True, max_length=20)),
                ('confidence', models.PositiveSmallIntegerField(blank=True, null=True)),
                ('method', models.CharField(blank=True, max_length=20)),
                ('findings', models.TextField(blank=True)),
                ('guidance', models.TextField(blank=True)),
                ('disease', models.JSONField(blank=True, null=True)),
                ('date_client', models.CharField(blank=True, max_length=100)),
                ('follow_up_at', models.BigIntegerField(blank=True, null=True)),
                ('follow_up_done', models.BooleanField(default=False)),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('source_updated_at', models.BigIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
