locals {
  account_id = "ed3ca575118099486baeb129959697c8"
  # Each environment's data, named from its prefix. Production keeps the prototype's names: the real migration fills a
  # fresh database and buckets anyway, and they get the final names then.
  environments = {
    production = { prefix = "tacocat-proto", site_origin = "https://pix.deanmoses.com" }
    staging    = { prefix = "tacocat-staging", site_origin = "https://staging-pix.deanmoses.com" }
  }
}

resource "cloudflare_zone" "deanmoses" {
  account = { id = local.account_id }
  name    = "deanmoses.com"
}

# Plain HTTP is answered with a redirect and TLS below 1.2 is refused, on every proxied hostname in the zone.
resource "cloudflare_zone_setting" "deanmoses_always_use_https" {
  zone_id    = cloudflare_zone.deanmoses.id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "deanmoses_min_tls_version" {
  zone_id    = cloudflare_zone.deanmoses.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

# The Link headers an album page sends (web/static/_headers) go out as a 103 Early Hints before the page itself, so the
# browser starts the album JSON request on the first bytes back from the edge.
resource "cloudflare_zone_setting" "deanmoses_early_hints" {
  zone_id    = cloudflare_zone.deanmoses.id
  setting_id = "early_hints"
  value      = "on"
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

module "environment" {
  source      = "./environment"
  for_each    = local.environments
  account_id  = local.account_id
  prefix      = each.value.prefix
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
