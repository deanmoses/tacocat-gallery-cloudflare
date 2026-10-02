locals {
  account_id = "ed3ca575118099486baeb129959697c8"
  # Each environment's data, named from its prefix, which is the environment's own name: resource names are per
  # account, and the account is the gallery's, so the environment is all a name has to say.
  environments = {
    production = { prefix = "production", site_origin = "https://pix.tacocat.com" }
    staging    = { prefix = "staging", site_origin = "https://staging-pix.tacocat.com" }
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

# Archive crawlers, the Internet Archive's above all, are not among the AI bots Cloudflare blocks, and a page in an
# archive is on the public web whatever its noindex says. The category is Cloudflare's list of verified archivers; the
# user agents catch the Internet Archive's own crawlers when a request is not verified as theirs.
#
# The rule names the gallery's hostnames because a zone's rules apply to every hostname proxied in it, and whether to
# keep archives off the rest of tacocat.com is not the gallery's to decide.
#
# AI Crawl Control's per-crawler switches write their rule into this same ruleset, so one set in the dashboard shows
# up here as a change to revert: block a crawler by adding it to the expression.
locals {
  archiver_block_hosts = {
    deanmoses = { zone_id = cloudflare_zone.deanmoses.id, hosts = ["pix.deanmoses.com"] }
    tacocat   = { zone_id = cloudflare_zone.tacocat.id, hosts = ["pix.tacocat.com", "staging-pix.tacocat.com"] }
  }
}

resource "cloudflare_ruleset" "block_archivers" {
  for_each = local.archiver_block_hosts
  zone_id  = each.value.zone_id
  name     = "default"
  kind     = "zone"
  phase    = "http_request_firewall_custom"
  rules = [{
    description = "Block archive crawlers"
    action      = "block"
    expression  = "(http.host in {${join(" ", formatlist("\"%s\"", each.value.hosts))}}) and ((cf.verified_bot_category eq \"Archiver\") or (lower(http.user_agent) contains \"archive.org_bot\") or (lower(http.user_agent) contains \"ia_archiver\"))"
  }]
}

module "environment" {
  source      = "./environment"
  for_each    = local.environments
  account_id  = local.account_id
  prefix      = each.value.prefix
  site_origin = each.value.site_origin
}

# What api/wrangler.jsonc needs from here.
output "d1_database_ids" {
  value = { for name, environment in module.environment : name => environment.d1_database_id }
}

# What the nightly backup workflow reads the originals with: production's bucket, and nothing it could write.
data "cloudflare_account_api_token_permission_groups_list" "bucket_item_read" {
  account_id = local.account_id
  name       = "Workers R2 Storage Bucket Item Read"
}

resource "cloudflare_account_token" "backup" {
  account_id = local.account_id
  name       = "backup"
  policies = [{
    effect            = "allow"
    permission_groups = [{ id = data.cloudflare_account_api_token_permission_groups_list.bucket_item_read.result[0].id }]
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${local.account_id}_default_${module.environment["production"].originals_bucket}" = "*"
    })
  }]
}

# What the nightly backup workflow exports the database with: D1 and nothing else, in place of the deploy token.
# Write rather than Read, since the export endpoint refuses a read-only token.
data "cloudflare_account_api_token_permission_groups_list" "d1_edit" {
  account_id = local.account_id
  name       = "D1 Write"
}

resource "cloudflare_account_token" "d1_export" {
  account_id = local.account_id
  name       = "d1-export"
  policies = [{
    effect            = "allow"
    permission_groups = [{ id = data.cloudflare_account_api_token_permission_groups_list.d1_edit.result[0].id }]
    resources         = jsonencode({ "com.cloudflare.api.account.${local.account_id}" = "*" })
  }]
}

output "d1_export_token" {
  value     = cloudflare_account_token.d1_export.value
  sensitive = true
}

# Each token as S3 credentials, for scripts/secrets.sh to put where they are used.
output "r2_credentials" {
  value = merge(
    { for name, environment in module.environment : name => environment.signing_credentials },
    {
      backup = {
        access_key_id     = cloudflare_account_token.backup.id
        secret_access_key = sha256(cloudflare_account_token.backup.value)
      }
    },
  )
  sensitive = true
}
