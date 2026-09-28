# One environment's data: its database, its buckets and the queue its uploads arrive through. The Worker that binds
# them is declared per environment in api/wrangler.jsonc.

variable "account_id" {
  type = string
}

variable "prefix" {
  type        = string
  description = "What every resource's name starts with, such as tacocat-staging."
}

variable "site_origin" {
  type        = string
  description = "The origin the web app runs on, such as https://pix.deanmoses.com, which browsers upload from."
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

# The browser PUTs an upload straight to the media bucket with a URL the Worker signed, which is a cross-origin request
# from the site, and from the local dev server while developing. The one header it sends is the file's own content type.
resource "cloudflare_r2_bucket_cors" "media" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.media.name
  rules = [{
    allowed = {
      origins = [var.site_origin, "http://localhost:8787"]
      methods = ["PUT"]
      headers = ["content-type"]
    }
    max_age_seconds = 3600
  }]
}

resource "cloudflare_r2_bucket" "derived" {
  account_id = var.account_id
  name       = "${var.prefix}-derived"
  location   = "wnam"
  lifecycle {
    prevent_destroy = true
  }
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
