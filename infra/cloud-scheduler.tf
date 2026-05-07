# 旧朝バッチ用 Cloud Scheduler は preview-realtime → Pub/Sub → Eventarc 経路への
# 移行に伴い廃止。当日初回ビルドは preview-realtime の 08:30 JST 系列の Scheduler
# 発火で programs/title・race_cards も含めて GCS にミラーされ、Pub/Sub 経由で
# fun-site の Cloud Run Job が起動する。
#
# このファイルは意図的に空。`terraform apply` で `google_cloud_scheduler_job.daily_batch`
# が destroy される。新規 PR でファイル自体を削除しても良い。
