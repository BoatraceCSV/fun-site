# -----------------------------------------------------------------------------
# Global external Application Load Balancer + Cloud CDN
# Backend: Cloud Storage web bucket
# -----------------------------------------------------------------------------
# 配信は Firebase Hosting (firebase.tf) に移し、var.web_hosting = "firebase_only" で
# 丸ごと削除する (forwarding rule の固定費 月 ~$18 が費用の最大項目だった)。
# 切替手順は docs/operations.md「Firebase Hosting への切替」を参照。

# Reserve a global static IP
resource "google_compute_global_address" "default" {
  count = local.lb_enabled ? 1 : 0

  name = "${local.prefix}-lb-ip"
}

# Backend bucket pointing to the web hosting Cloud Storage bucket
resource "google_compute_backend_bucket" "web" {
  count = local.lb_enabled ? 1 : 0

  name        = "${local.prefix}-web-backend"
  bucket_name = google_storage_bucket.web.name
  enable_cdn  = true

  cdn_policy {
    cache_mode                   = "CACHE_ALL_STATIC"
    default_ttl                  = var.cdn_cache_ttl
    max_ttl                      = var.cdn_cache_ttl * 24
    client_ttl                   = var.cdn_cache_ttl
    negative_caching             = true
    serve_while_stale            = 86400
    signed_url_cache_max_age_sec = 0

    cache_key_policy {
      include_http_headers = []
    }
  }
}

# URL map
resource "google_compute_url_map" "default" {
  count = local.lb_enabled ? 1 : 0

  name            = "${local.prefix}-url-map"
  default_service = google_compute_backend_bucket.web[0].id
}

# SSL certificate via Certificate Manager
resource "google_certificate_manager_certificate" "default" {
  count = local.lb_enabled ? 1 : 0

  name = "${local.prefix}-cert"

  managed {
    domains = [var.domain_name]
  }
}

resource "google_certificate_manager_certificate_map" "default" {
  count = local.lb_enabled ? 1 : 0

  name = "${local.prefix}-cert-map"
}

resource "google_certificate_manager_certificate_map_entry" "default" {
  count = local.lb_enabled ? 1 : 0

  name         = "${local.prefix}-cert-map-entry"
  map          = google_certificate_manager_certificate_map.default[0].name
  certificates = [google_certificate_manager_certificate.default[0].id]
  hostname     = var.domain_name
}

# HTTPS target proxy
resource "google_compute_target_https_proxy" "default" {
  count = local.lb_enabled ? 1 : 0

  name            = "${local.prefix}-https-proxy"
  url_map         = google_compute_url_map.default[0].id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.default[0].id}"
}

# HTTP target proxy (redirect to HTTPS)
resource "google_compute_url_map" "http_redirect" {
  count = local.lb_enabled ? 1 : 0

  name = "${local.prefix}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count = local.lb_enabled ? 1 : 0

  name    = "${local.prefix}-http-redirect-proxy"
  url_map = google_compute_url_map.http_redirect[0].id
}

# Forwarding rules (HTTPS + HTTP redirect)
resource "google_compute_global_forwarding_rule" "https" {
  count = local.lb_enabled ? 1 : 0

  name                  = "${local.prefix}-https-forwarding"
  ip_address            = google_compute_global_address.default[0].address
  ip_protocol           = "TCP"
  port_range            = "443"
  target                = google_compute_target_https_proxy.default[0].id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  count = local.lb_enabled ? 1 : 0

  name                  = "${local.prefix}-http-redirect-forwarding"
  ip_address            = google_compute_global_address.default[0].address
  ip_protocol           = "TCP"
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect[0].id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# count 追加前の state を引き継ぐ
moved {
  from = google_compute_global_address.default
  to   = google_compute_global_address.default[0]
}

moved {
  from = google_compute_backend_bucket.web
  to   = google_compute_backend_bucket.web[0]
}

moved {
  from = google_compute_url_map.default
  to   = google_compute_url_map.default[0]
}

moved {
  from = google_certificate_manager_certificate.default
  to   = google_certificate_manager_certificate.default[0]
}

moved {
  from = google_certificate_manager_certificate_map.default
  to   = google_certificate_manager_certificate_map.default[0]
}

moved {
  from = google_certificate_manager_certificate_map_entry.default
  to   = google_certificate_manager_certificate_map_entry.default[0]
}

moved {
  from = google_compute_target_https_proxy.default
  to   = google_compute_target_https_proxy.default[0]
}

moved {
  from = google_compute_url_map.http_redirect
  to   = google_compute_url_map.http_redirect[0]
}

moved {
  from = google_compute_target_http_proxy.redirect
  to   = google_compute_target_http_proxy.redirect[0]
}

moved {
  from = google_compute_global_forwarding_rule.https
  to   = google_compute_global_forwarding_rule.https[0]
}

moved {
  from = google_compute_global_forwarding_rule.http_redirect
  to   = google_compute_global_forwarding_rule.http_redirect[0]
}
