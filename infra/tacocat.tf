# The tacocat.com zone, which GoDaddy's nameservers point at. Its records are the ones DreamHost served while it held
# the zone, DNS-only. Records that point at AWS stay DNS-only, since proxying in front of CloudFront would stack two
# CDNs; the ACM validation CNAMEs keep the AWS certificates renewing; the Google records carry the mail, and the DKIM
# key is the one most easily damaged in a copy. The apex, www, ftp and ssh records point at DreamHost, which still hosts
# the landing page. DreamHost's zone is the way back, so a record changed here and not there is lost on a return to its
# nameservers.
#
# Gone since 2026-10-02: prod-pix and dev-pix with their www, ftp and ssh names, gallery3 and vercel-pix, the records
# of the gallery generations that ran on DreamHost and Vercel before AWS, removed once DreamHost stopped hosting the
# two names; and the AWS gallery's staging and test names (api, auth and img of staging-pix and test-pix), Cognito's
# login, their ACM validation CNAMEs, and start, Google Apps' start page, retired in 2013. DreamHost's zone still has
# them all. The AWS production names, api, auth and img of pix, stay until the AWS gallery is retired, since a
# resolver that still caches the old delegation sends its readers to the AWS app, which calls them.
#
# pix.tacocat.com and staging-pix.tacocat.com have no record here: they are the Workers' custom domains, whose records
# Cloudflare makes when a Worker's triggers deploy, and refuses to make while another record holds the name.
resource "cloudflare_zone" "tacocat" {
  account = { id = local.account_id }
  name    = "tacocat.com"
}

# The edge settings apply to the proxied hostnames, which are the gallery's; every record below is DNS-only.
#
# Plain HTTP is answered with a redirect and TLS below 1.2 is refused.
resource "cloudflare_zone_setting" "tacocat_always_use_https" {
  zone_id    = cloudflare_zone.tacocat.id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "tacocat_min_tls_version" {
  zone_id    = cloudflare_zone.tacocat.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

# The Link headers an album page sends (web/static/_headers) go out as a 103 Early Hints before the page itself, so the
# browser starts the album JSON request on the first bytes back from the edge.
resource "cloudflare_zone_setting" "tacocat_early_hints" {
  zone_id    = cloudflare_zone.tacocat.id
  setting_id = "early_hints"
  value      = "on"
}

# Smart Tiered Cache needs both: tiered caching on, and the smart topology that picks upper tiers near the origin.
resource "cloudflare_argo_tiered_caching" "tacocat" {
  zone_id = cloudflare_zone.tacocat.id
  value   = "on"
}

resource "cloudflare_tiered_cache" "tacocat" {
  zone_id = cloudflare_zone.tacocat.id
  value   = "on"
}

# The per-category AI policies (ai_training, ai_search, ai_user: all "block") were set through the API, and the bot
# preference sync, which puts them at the top of robots.txt, in the dashboard: the provider sets neither. A request
# that sets the categories turns ai_bots_protection off, so it is applied again afterwards.
resource "cloudflare_bot_management" "tacocat" {
  zone_id                     = cloudflare_zone.tacocat.id
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

locals {
  tacocat_records = [
    { name = "tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "ftp.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "ssh.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "www.tacocat.com", type = "A", content = "205.196.220.123" },
    { name = "tacocat.com", type = "MX", content = "ASPMX.L.GOOGLE.com", priority = 1 },
    { name = "tacocat.com", type = "MX", content = "ALT1.ASPMX.L.GOOGLE.com", priority = 5 },
    { name = "tacocat.com", type = "MX", content = "ALT2.ASPMX.L.GOOGLE.com", priority = 5 },
    { name = "tacocat.com", type = "MX", content = "ALT3.ASPMX.L.GOOGLE.com", priority = 10 },
    { name = "tacocat.com", type = "MX", content = "ALT4.ASPMX.L.GOOGLE.com", priority = 10 },
    { name = "tacocat.com", type = "TXT", content = "google-site-verification=En35chboU0PBIeqQIplDlcsFlCzOa-DzCv8VMuqhyR0" },
    { name = "google._domainkey.tacocat.com", type = "TXT", content = "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsh1aXVm2tMG9C5nUVjuf3vkfXKMlTmfZhUFVoVqUAWBf/WZzPlTGk/g2wbBB6tCa6f/zGYAPDstHOlAgakHnv5DxyNjGXDYxlxU21xJeTdl2MiXCHfb708Oj7eXmL6Y+GMWh4Iz5z87znL+rocOKp4g2bvjheqI46RlBSatWoHn27+g719M1qFftCy0jEcDgFs+yhoYbdCcJW9HkDTQ8s3piTgOxRtdp7SqlgsDkQADat4/zTFqCHE2G3txhRTbTDEqXf5wzVhU/ZvizP8Ce8pI4/7EClehUNf/igMc3Zj7iXcCtrwg0aoHgVuJBzoOQUlIsd5vNhjjVQdJYAlRcHwIDAQAB" },
    { name = "calendar.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
    { name = "docs.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
    { name = "mail.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
    { name = "_b1a5820fc945c5088c062d7252699084.pix.tacocat.com", type = "CNAME", content = "_b39041744b397810c04ea672579e7096.dsrmygwdhx.acm-validations.aws" },
    { name = "api.pix.tacocat.com", type = "CNAME", content = "d-pbw01cw1w4.execute-api.us-east-1.amazonaws.com" },
    { name = "_393638dd6d38bda98192026a4d429bc1.api.pix.tacocat.com", type = "CNAME", content = "_bd208acffa07d0686742504b3d24c312.mhbtsbpdnt.acm-validations.aws" },
    { name = "auth.pix.tacocat.com", type = "CNAME", content = "d-pzj5ol8pj0.execute-api.us-east-1.amazonaws.com" },
    { name = "_60f04a93910b2b667861aca98143a538.auth.pix.tacocat.com", type = "CNAME", content = "_1a539e72bf9a205b49e31133c1907757.smwfzlpyzn.acm-validations.aws" },
    { name = "img.pix.tacocat.com", type = "CNAME", content = "d1vn5u5nd1mlwb.cloudfront.net" },
    { name = "_ba116a8ca29600016f5fb962d2452b67.img.pix.tacocat.com", type = "CNAME", content = "_12cf0d0620fa964c8c708c7bcfcd69b4.mhbtsbpdnt.acm-validations.aws" },
    { name = "sites.tacocat.com", type = "CNAME", content = "ghs.googlehosted.com" },
  ]
}

resource "cloudflare_dns_record" "tacocat" {
  for_each = { for record in local.tacocat_records : "${record.name} ${record.type} ${record.content}" => record }
  zone_id  = cloudflare_zone.tacocat.id
  name     = each.value.name
  type     = each.value.type
  # Cloudflare stores a target in lower case, and would otherwise want to change the MX targets, which DreamHost serves in
  # upper case, on every plan. TXT values are data, and the DKIM key's case is part of it.
  content  = each.value.type == "TXT" ? each.value.content : lower(each.value.content)
  priority = lookup(each.value, "priority", null)
  proxied  = false
  # DreamHost served every record with a 60 s TTL.
  ttl = 60
}

output "tacocat_name_servers" {
  value = cloudflare_zone.tacocat.name_servers
}
