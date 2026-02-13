# -----------------------------------------------------------------------------
# Global external Application Load Balancer + Cloud CDN
# Backend: Cloud Storage web bucket
# -----------------------------------------------------------------------------

# Reserve a global static IP
resource "google_compute_global_address" "default" {
  name = "${local.prefix}-lb-ip"
}

# Backend bucket pointing to the web hosting Cloud Storage bucket
resource "google_compute_backend_bucket" "web" {
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
  name            = "${local.prefix}-url-map"
  default_service = google_compute_backend_bucket.web.id
}

# SSL certificate via Certificate Manager
resource "google_certificate_manager_certificate" "default" {
  name = "${local.prefix}-cert"

  managed {
    domains = [var.domain_name]
  }
}

resource "google_certificate_manager_certificate_map" "default" {
  name = "${local.prefix}-cert-map"
}

resource "google_certificate_manager_certificate_map_entry" "default" {
  name         = "${local.prefix}-cert-map-entry"
  map          = google_certificate_manager_certificate_map.default.name
  certificates = [google_certificate_manager_certificate.default.id]
  hostname     = var.domain_name
}

# HTTPS target proxy
resource "google_compute_target_https_proxy" "default" {
  name             = "${local.prefix}-https-proxy"
  url_map          = google_compute_url_map.default.id
  certificate_map  = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.default.id}"
}

# HTTP target proxy (redirect to HTTPS)
resource "google_compute_url_map" "http_redirect" {
  name = "${local.prefix}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "${local.prefix}-http-redirect-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

# Forwarding rules (HTTPS + HTTP redirect)
resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${local.prefix}-https-forwarding"
  ip_address            = google_compute_global_address.default.address
  ip_protocol           = "TCP"
  port_range            = "443"
  target                = google_compute_target_https_proxy.default.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name                  = "${local.prefix}-http-redirect-forwarding"
  ip_address            = google_compute_global_address.default.address
  ip_protocol           = "TCP"
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
