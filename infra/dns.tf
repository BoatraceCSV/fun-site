# -----------------------------------------------------------------------------
# Cloud DNS managed zone + A record for the load balancer
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
  rrdatas      = [google_compute_global_address.default.address]
}
