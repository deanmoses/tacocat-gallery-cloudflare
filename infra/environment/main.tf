# One environment's data: its database, its buckets, the queue its uploads arrive through, and the hostname its derived
# images are served from. The Worker that binds them is declared per environment in api/wrangler.jsonc.

variable "account_id" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "prefix" {
  type        = string
  description = "What every resource's name starts with, such as tacocat-staging."
}

variable "image_host" {
  type        = string
  description = "The hostname the derived bucket is served from, such as img.deanmoses.com."
}

resource "cloudflare_d1_database" "this" {
  account_id            = var.account_id
  name                  = var.prefix
  primary_location_hint = "wnam"
  read_replication      = { mode = "auto" }
  lifecycle {
    prevent_destroy = true
    # The API does not return the hint, so an imported database would otherwise plan a replacement.
    ignore_changes = [primary_location_hint]
  }
}

resource "cloudflare_r2_bucket" "media" {
  account_id = var.account_id
  name       = "${var.prefix}-media"
  location   = "wnam"
  lifecycle {
    prevent_destroy = true
  }
}

# Public through its custom domain, so it must never hold originals.
resource "cloudflare_r2_bucket" "derived" {
  account_id = var.account_id
  name       = "${var.prefix}-derived"
  location   = "wnam"
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_custom_domain" "img" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.derived.name
  domain      = var.image_host
  zone_id     = var.zone_id
  enabled     = true
  min_tls     = "1.2"
}

resource "cloudflare_queue" "uploads" {
  account_id = var.account_id
  queue_name = "${var.prefix}-uploads"
}

# Upload messages that run out of retries land here (see dead_letter_queue in api/wrangler.jsonc).
resource "cloudflare_queue" "uploads_dlq" {
  account_id = var.account_id
  queue_name = "${var.prefix}-uploads-dlq"
}

resource "cloudflare_r2_bucket_event_notification" "uploads" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.media.name
  queue_id    = cloudflare_queue.uploads.queue_id
  rules = [{
    prefix = "inbox/"
    # The API returns "" for no suffix; null would show a diff on every plan.
    suffix  = ""
    actions = ["PutObject", "CompleteMultipartUpload", "CopyObject"]
  }]
}

output "d1_database_id" {
  value = cloudflare_d1_database.this.id
}

output "image_host" {
  value = var.image_host
}
