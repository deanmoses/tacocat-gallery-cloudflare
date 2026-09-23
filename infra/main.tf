locals {
  account_id = "ed3ca575118099486baeb129959697c8"
}

resource "cloudflare_zone" "deanmoses" {
  account = { id = local.account_id }
  name    = "deanmoses.com"
}

# Smart Tiered Cache needs both: tiered caching on, and the smart topology that picks upper tiers near the origin.
resource "cloudflare_argo_tiered_caching" "deanmoses" {
  zone_id = cloudflare_zone.deanmoses.id
  value   = "on"
}

resource "cloudflare_tiered_cache" "deanmoses" {
  zone_id = cloudflare_zone.deanmoses.id
  value   = "on"
}

# The per-category AI policies (training, search, agent: all "block") are not in provider v5.25.0 and were set at
# zone onboarding; ai_bots_protection is the enforcing rule that is.
resource "cloudflare_bot_management" "deanmoses" {
  zone_id                     = cloudflare_zone.deanmoses.id
  ai_bots_protection          = "block"
  bot_preference_sync_enabled = true
  cf_robots_variant           = "policy_only"
  # Bot Fight Mode would challenge the Globalping probes the latency measurements depend on.
  fight_mode = false
  lifecycle {
    # Provider v5.25.0 does not read these two back, so they would show a diff on every plan.
    ignore_changes = [bot_preference_sync_enabled, cf_robots_variant]
  }
}

# Derived-image keys have no file extension, which Cloudflare does not cache by default.
resource "cloudflare_ruleset" "cache" {
  zone_id = cloudflare_zone.deanmoses.id
  name    = "cache"
  kind    = "zone"
  phase   = "http_request_cache_settings"
  rules = [{
    description = "Cache derived images from R2"
    expression  = "(http.host eq \"img.deanmoses.com\")"
    action      = "set_cache_settings"
    action_parameters = {
      cache    = true
      edge_ttl = { mode = "respect_origin" }
    }
  }]
}

resource "cloudflare_d1_database" "proto" {
  account_id            = local.account_id
  name                  = "tacocat-proto"
  primary_location_hint = "wnam"
  read_replication      = { mode = "auto" }
  lifecycle {
    prevent_destroy = true
    # The API does not return the hint, so an imported database would otherwise plan a replacement.
    ignore_changes = [primary_location_hint]
  }
}

resource "cloudflare_r2_bucket" "media" {
  account_id = local.account_id
  name       = "tacocat-proto-media"
  location   = "wnam"
  lifecycle {
    prevent_destroy = true
  }
}

# Public through img.deanmoses.com, so it must never hold originals.
resource "cloudflare_r2_bucket" "derived" {
  account_id = local.account_id
  name       = "tacocat-proto-derived"
  location   = "wnam"
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_custom_domain" "img" {
  account_id  = local.account_id
  bucket_name = cloudflare_r2_bucket.derived.name
  domain      = "img.deanmoses.com"
  zone_id     = cloudflare_zone.deanmoses.id
  enabled     = true
  min_tls     = "1.2"
}

resource "cloudflare_queue" "uploads" {
  account_id = local.account_id
  queue_name = "tacocat-proto-uploads"
}

# Upload messages that run out of retries land here (see dead_letter_queue in wrangler.jsonc).
resource "cloudflare_queue" "uploads_dlq" {
  account_id = local.account_id
  queue_name = "tacocat-proto-uploads-dlq"
}

resource "cloudflare_r2_bucket_event_notification" "uploads" {
  account_id  = local.account_id
  bucket_name = cloudflare_r2_bucket.media.name
  queue_id    = cloudflare_queue.uploads.queue_id
  rules = [{
    prefix = "inbox/"
    # The API returns "" for no suffix; null would show a diff on every plan.
    suffix  = ""
    actions = ["PutObject", "CompleteMultipartUpload", "CopyObject"]
  }]
}
