locals {
  account_id = "ed3ca575118099486baeb129959697c8"
  # Each environment's data, named from its prefix. Production keeps the prototype's names: the real migration fills a
  # fresh database and buckets anyway, and they get the final names then.
  environments = {
    production = { prefix = "tacocat-proto", image_host = "img.deanmoses.com", site_origin = "https://pix.deanmoses.com" }
    staging    = { prefix = "tacocat-staging", image_host = "staging-img.deanmoses.com", site_origin = "https://staging-pix.deanmoses.com" }
  }
  # A request to either environment's image host, for the zone rules that apply to derived images alone.
  image_hosts_expression = "(http.host in {${join(" ", [for environment in local.environments : format("%q", environment.image_host)])}})"
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
    expression  = local.image_hosts_expression
    action      = "set_cache_settings"
    action_parameters = {
      cache    = true
      edge_ttl = { mode = "respect_origin" }
    }
  }]
}

# The image hosts serve stored derivatives straight from R2, never through the Worker, so the headers every response
# from the site carries (api/src/http/headers.ts, with the reasons) are set here for them: the ones that mean something
# on an image, since a frame, referrer or permissions policy says nothing there. Cross-Origin-Resource-Policy keeps
# other sites from embedding the photos; the gallery is the same site, so it is unaffected.
resource "cloudflare_ruleset" "image_headers" {
  zone_id = cloudflare_zone.deanmoses.id
  name    = "image headers"
  kind    = "zone"
  phase   = "http_response_headers_transform"
  rules = [{
    description = "Crawler opt-out and security headers on derived images from R2"
    expression  = local.image_hosts_expression
    action      = "rewrite"
    action_parameters = {
      headers = {
        "X-Robots-Tag"                 = { operation = "set", value = "noindex, noimageindex, nosnippet, max-image-preview:none, notranslate, noarchive, noai, noimageai" }
        "tdm-reservation"              = { operation = "set", value = "1" }
        "Strict-Transport-Security"    = { operation = "set", value = "max-age=31536000; includeSubDomains" }
        "X-Content-Type-Options"       = { operation = "set", value = "nosniff" }
        "Cross-Origin-Resource-Policy" = { operation = "set", value = "same-site" }
      }
    }
  }]
}

module "environment" {
  source      = "./environment"
  for_each    = local.environments
  account_id  = local.account_id
  zone_id     = cloudflare_zone.deanmoses.id
  prefix      = each.value.prefix
  image_host  = each.value.image_host
  site_origin = each.value.site_origin
}

# Production's resources predate the module; these keep their state where it is instead of destroying and recreating.
moved {
  from = cloudflare_d1_database.proto
  to   = module.environment["production"].cloudflare_d1_database.this
}

moved {
  from = cloudflare_r2_bucket.media
  to   = module.environment["production"].cloudflare_r2_bucket.media
}

moved {
  from = cloudflare_r2_bucket.derived
  to   = module.environment["production"].cloudflare_r2_bucket.derived
}

moved {
  from = cloudflare_r2_custom_domain.img
  to   = module.environment["production"].cloudflare_r2_custom_domain.img
}

moved {
  from = cloudflare_queue.uploads
  to   = module.environment["production"].cloudflare_queue.uploads
}

moved {
  from = cloudflare_queue.uploads_dlq
  to   = module.environment["production"].cloudflare_queue.uploads_dlq
}

moved {
  from = cloudflare_r2_bucket_event_notification.uploads
  to   = module.environment["production"].cloudflare_r2_bucket_event_notification.uploads
}

# What api/wrangler.jsonc needs from here.
output "d1_database_ids" {
  value = { for name, environment in module.environment : name => environment.d1_database_id }
}
