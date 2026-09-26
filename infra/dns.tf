# -----------------------------------------------------------------------------
# Cloud DNS managed zone + A record (LB または Firebase Hosting)
# -----------------------------------------------------------------------------
resource "google_dns_managed_zone" "default" {
  name        = "${local.prefix}-zone"
  dns_name    = "${var.domain_name}."
  description = "DNS zone for ${var.domain_name}"
  labels      = local.labels
}

resource "google_dns_record_set" "a" {
  name         = "${var.domain_name}."
  managed_zone = google_dns_managed_zone.default.name
  type         = "A"
  ttl          = 300
  rrdatas = (
    local.dns_on_lb
    ? [google_compute_global_address.default[0].address]
    : [var.firebase_hosting_ip]
  )
}

# Firebase Hosting のカスタムドメイン所有権確認用
resource "google_dns_record_set" "firebase_hosting_txt" {
  name         = "${var.domain_name}."
  managed_zone = google_dns_managed_zone.default.name
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"hosting-site=${var.firebase_hosting_site_id}\""]
}
